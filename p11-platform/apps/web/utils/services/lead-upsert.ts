import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'

type LeadRow = Database['public']['Tables']['leads']['Row']
type LeadInsert = Database['public']['Tables']['leads']['Insert']
type LeadUpdate = Database['public']['Tables']['leads']['Update']

const REPEAT_ACTIVITY_DEDUPE_WINDOW_MS = 5 * 60 * 1000

export class LeadUpsertError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
    this.name = 'LeadUpsertError'
  }
}

export interface RepeatLeadActivity {
  type?: string
  description: string
  metadata?: Record<string, unknown>
}

export interface UpsertLeadByContactInput {
  client: SupabaseClient<Database>
  propertyId: string
  email?: string | null
  phone?: string | null
  existingLeadId?: string | null
  create: Omit<LeadInsert, 'property_id'>
  update: LeadUpdate
  repeatActivity?: RepeatLeadActivity
}

export interface UpsertLeadByContactResult {
  lead: LeadRow
  leadId: string
  isExisting: boolean
  matchedBy: 'id' | 'email' | 'phone' | null
}

type ExistingLeadIdentity = Pick<LeadRow, 'id' | 'notes'>

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

async function findExistingLead(
  input: UpsertLeadByContactInput
): Promise<{
  lead: ExistingLeadIdentity | null
  matchedBy: UpsertLeadByContactResult['matchedBy']
}> {
  const { client, propertyId } = input

  if (input.existingLeadId) {
    const { data, error } = await client
      .from('leads')
      .select('id, notes')
      .eq('id', input.existingLeadId)
      .eq('property_id', propertyId)
      .maybeSingle()

    if (error) {
      throw new Error(`Failed to resolve existing lead: ${error.message}`)
    }
    if (data) return { lead: data, matchedBy: 'id' }
  }

  const email = input.email?.trim()
  if (email) {
    const { data, error } = await client
      .from('leads')
      .select('id, notes')
      .eq('property_id', propertyId)
      .ilike('email', escapeLikePattern(email))
      .limit(1)

    if (error) {
      throw new Error(`Failed to match lead by email: ${error.message}`)
    }
    if (data?.[0]) return { lead: data[0], matchedBy: 'email' }
  }

  const phone = input.phone?.trim()
  if (phone) {
    const { data, error } = await client
      .from('leads')
      .select('id, notes')
      .eq('property_id', propertyId)
      .eq('phone', phone)
      .limit(1)

    if (error) {
      throw new Error(`Failed to match lead by phone: ${error.message}`)
    }
    if (data?.[0]) return { lead: data[0], matchedBy: 'phone' }
  }

  return { lead: null, matchedBy: null }
}

function mergeNotes(
  currentNotes: string | null,
  incomingNotes: string | null | undefined
): string | null | undefined {
  const incoming = incomingNotes?.trim()
  if (!incoming) return incomingNotes
  if (currentNotes?.includes(incoming)) return currentNotes
  return currentNotes ? `${currentNotes}\n\n${incoming}` : incoming
}

async function recordRepeatActivity(
  input: UpsertLeadByContactInput,
  leadId: string
) {
  if (!input.repeatActivity) return

  const type = input.repeatActivity.type || 'note'
  const duplicateCutoff = new Date(
    Date.now() - REPEAT_ACTIVITY_DEDUPE_WINDOW_MS
  ).toISOString()
  const { data: existingActivity, error: activityLookupError } =
    await input.client
      .from('lead_activities')
      .select('id')
      .eq('lead_id', leadId)
      .eq('type', type)
      .eq('description', input.repeatActivity.description)
      .gte('created_at', duplicateCutoff)
      .maybeSingle()

  if (activityLookupError) {
    throw new Error(
      `Failed to check repeat lead activity: ${activityLookupError.message}`
    )
  }
  if (existingActivity) return

  const { error: activityError } = await input.client
    .from('lead_activities')
    .insert({
      lead_id: leadId,
      type,
      description: input.repeatActivity.description,
      metadata: (input.repeatActivity.metadata || {}) as Json,
    })

  if (activityError) {
    throw new Error(`Failed to record repeat lead activity: ${activityError.message}`)
  }
}

export async function upsertLeadByContact(
  input: UpsertLeadByContactInput
): Promise<UpsertLeadByContactResult> {
  const existing = await findExistingLead(input)

  if (existing.lead) {
    const update: LeadUpdate = {
      ...input.update,
      updated_at: new Date().toISOString(),
    }
    if (Object.prototype.hasOwnProperty.call(update, 'notes')) {
      update.notes = mergeNotes(existing.lead.notes, update.notes)
    }

    const { data: lead, error } = await input.client
      .from('leads')
      .update(update)
      .eq('id', existing.lead.id)
      .eq('property_id', input.propertyId)
      .select()
      .single()

    if (error || !lead) {
      throw new Error(`Failed to update existing lead: ${error?.message || 'Lead not found'}`)
    }

    await recordRepeatActivity(input, lead.id)

    return {
      lead,
      leadId: lead.id,
      isExisting: true,
      matchedBy: existing.matchedBy,
    }
  }

  const { data: lead, error } = await input.client
    .from('leads')
    .insert({
      ...input.create,
      property_id: input.propertyId,
    })
    .select()
    .single()

  if (error || !lead) {
    throw new LeadUpsertError(
      `Failed to create lead: ${error?.message || 'No lead returned'}`,
      error?.code
    )
  }

  return {
    lead,
    leadId: lead.id,
    isExisting: false,
    matchedBy: null,
  }
}
