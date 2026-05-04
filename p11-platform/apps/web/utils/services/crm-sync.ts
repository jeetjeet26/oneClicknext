/**
 * CRM Sync Utility
 * Helper functions for syncing leads to client CRMs
 */

import { createServiceClient } from '@/utils/supabase/admin'
import { getDataEngineUrl } from '@/utils/services/runtime-config'

const DATA_ENGINE_URL = getDataEngineUrl()
const DATA_ENGINE_API_KEY = process.env.DATA_ENGINE_API_KEY || ''
const CRM_SYNC_MAX_RETRY_ATTEMPTS = 5
const CRM_SYNC_BASE_RETRY_DELAY_MS = 5 * 60 * 1000
const CRM_SYNC_PROCESSING_LEASE_MS = 5 * 60 * 1000

export interface LeadData {
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  source?: string
  status?: string
  move_in_date?: string
  bedrooms?: string | number
  notes?: string
}

export interface CRMSyncResult {
  success: boolean
  action: 'created' | 'linked' | 'skipped' | 'failed' | 'retry_scheduled' | 'dead_lettered'
  externalId?: string
  error?: string
  retryAt?: string
}

interface CRMSearchResult {
  success: boolean
  found: boolean
  externalId?: string
  matchType?: string
  error?: string
  retryable?: boolean
}

interface CRMIntegration {
  crmType: string
  credentials: unknown
  fieldMapping: Record<string, unknown> | null
  validated: boolean
}

interface SyncLeadToCRMOptions {
  attempt?: number
  preserveClaimLease?: boolean
}

interface LeadCRMSyncRow {
  id: string
  property_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  source: string | null
  status: string | null
  move_in_date: string | null
  bedrooms: number | null
  notes: string | null
  crm_sync_status: string | null
  crm_sync_retry_count: number | null
  crm_sync_next_retry_at: string | null
}

export interface ProcessPendingCRMSyncsResult {
  processed: number
  succeeded: number
  scheduledRetries: number
  deadLettered: number
  skipped: number
  failed: number
  errors: string[]
}

function isRetryableDataEngineStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function getRetryDelayMs(attempt: number): number {
  const retryAttempt = Math.max(1, attempt)
  return CRM_SYNC_BASE_RETRY_DELAY_MS * Math.pow(2, retryAttempt - 1)
}

function buildNextRetryAt(attempt: number): string {
  return new Date(Date.now() + getRetryDelayMs(attempt)).toISOString()
}

function normalizeCRMError(error: string | null | undefined, fallback: string): string {
  const normalized = error?.trim()
  return normalized?.length ? normalized : fallback
}

async function updateLeadCRMSyncState(
  leadId: string,
  payload: Record<string, unknown>
) {
  try {
    const supabase = createServiceClient()

    await supabase
      .from('leads')
      .update({
        ...payload,
        crm_synced_at: new Date().toISOString(),
      })
      .eq('id', leadId)
  } catch (err) {
    console.error('[CRM Sync] Failed to update lead status:', err)
  }
}

async function markLeadCRMSyncPending(leadId: string, attempt: number) {
  await updateLeadCRMSyncState(leadId, {
    crm_sync_status: attempt > 0 ? 'retrying' : 'pending',
    crm_sync_error: null,
    crm_sync_retry_count: attempt,
    crm_sync_next_retry_at: null,
    crm_dead_lettered_at: null,
  })
}

async function markLeadCRMSyncSuccess(
  leadId: string,
  externalId: string | null,
  status: 'created' | 'linked' | 'skipped',
  attempt: number
) {
  await updateLeadCRMSyncState(leadId, {
    external_crm_id: externalId,
    crm_sync_status: status,
    crm_sync_error: null,
    crm_sync_retry_count: attempt,
    crm_sync_next_retry_at: null,
    crm_dead_lettered_at: null,
  })
}

async function scheduleLeadCRMSyncRetry(
  leadId: string,
  error: string,
  attempt: number
): Promise<CRMSyncResult> {
  const retryAt = buildNextRetryAt(attempt)

  await updateLeadCRMSyncState(leadId, {
    external_crm_id: null,
    crm_sync_status: 'retrying',
    crm_sync_error: error,
    crm_sync_retry_count: attempt,
    crm_sync_next_retry_at: retryAt,
    crm_dead_lettered_at: null,
  })

  return {
    success: false,
    action: 'retry_scheduled',
    error,
    retryAt,
  }
}

async function deadLetterLeadCRMSync(
  leadId: string,
  error: string,
  attempt: number
): Promise<CRMSyncResult> {
  await updateLeadCRMSyncState(leadId, {
    external_crm_id: null,
    crm_sync_status: 'dead_lettered',
    crm_sync_error: error,
    crm_sync_retry_count: attempt,
    crm_sync_next_retry_at: null,
    crm_dead_lettered_at: new Date().toISOString(),
  })

  return {
    success: false,
    action: 'dead_lettered',
    error,
  }
}

async function resolveCRMSyncFailure(params: {
  leadId: string
  attempt: number
  error: string
  retryable: boolean
}): Promise<CRMSyncResult> {
  const normalizedError = normalizeCRMError(params.error, 'CRM sync failed')
  const nextAttempt = params.attempt + 1

  if (params.retryable && nextAttempt < CRM_SYNC_MAX_RETRY_ATTEMPTS) {
    return scheduleLeadCRMSyncRetry(params.leadId, normalizedError, nextAttempt)
  }

  return deadLetterLeadCRMSync(params.leadId, normalizedError, nextAttempt)
}

function buildLeadDataFromRow(lead: LeadCRMSyncRow): LeadData {
  return {
    first_name: lead.first_name || undefined,
    last_name: lead.last_name || undefined,
    email: lead.email || undefined,
    phone: lead.phone || undefined,
    source: lead.source || undefined,
    status: lead.status || undefined,
    move_in_date: lead.move_in_date || undefined,
    bedrooms: lead.bedrooms ?? undefined,
    notes: lead.notes || undefined,
  }
}

/**
 * Get CRM integration configuration for a property
 */
export async function getCRMIntegration(propertyId: string) {
  const supabase = createServiceClient()
  
  const { data, error } = await supabase
    .from('integration_credentials')
    .select('*')
    .eq('property_id', propertyId)
    .in('platform', ['crm', 'pms', 'yardi', 'realpage', 'salesforce', 'hubspot', 'lasso'])
    .eq('status', 'connected')
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return {
    crmType: data.platform,
    credentials: data.credentials,
    fieldMapping:
      data.field_mapping && typeof data.field_mapping === 'object' && !Array.isArray(data.field_mapping)
        ? (data.field_mapping as Record<string, unknown>)
        : null,
    validated: !!data.mapping_validated,
  } satisfies CRMIntegration
}

/**
 * Check if a lead already exists in the CRM
 */
export async function searchLeadInCRM(
  propertyId: string,
  email: string,
  phone?: string | null
): Promise<CRMSearchResult> {
  try {
    const integration = await getCRMIntegration(propertyId)
    if (!integration) {
      return { success: true, found: false }
    }

    if (!email && !phone) {
      return {
        success: false,
        found: false,
        error: 'CRM search requires an email or phone number',
      }
    }

    const response = await fetch(`${DATA_ENGINE_URL}/crm/search-lead`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': DATA_ENGINE_API_KEY,
      },
      body: JSON.stringify({
        property_id: propertyId,
        crm_type: integration.crmType,
        credentials: integration.credentials,
        email,
        phone: phone || undefined,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[CRM Sync] Search failed:', errorText)
      return {
        success: false,
        found: false,
        error: errorText || `CRM search failed (${response.status})`,
        retryable: isRetryableDataEngineStatus(response.status),
      }
    }

    const result = await response.json()
    return {
      success: true,
      found: result.found || false,
      externalId: result.external_id,
      matchType: result.match_type,
    }
  } catch (error) {
    console.error('[CRM Sync] Search error:', error)
    return {
      success: false,
      found: false,
      error: error instanceof Error ? error.message : 'Unknown CRM search error',
      retryable: true,
    }
  }
}

/**
 * Push a lead to the client's CRM
 */
export async function pushLeadToCRM(
  propertyId: string,
  leadId: string,
  leadData: LeadData,
  options?: SyncLeadToCRMOptions
): Promise<CRMSyncResult> {
  const attempt = options?.attempt ?? 0
  const preserveClaimLease = options?.preserveClaimLease === true

  try {
    if (!preserveClaimLease) {
      await markLeadCRMSyncPending(leadId, attempt)
    }

    const integration = await getCRMIntegration(propertyId)
    
    if (!integration) {
      console.log('[CRM Sync] No CRM integration configured for property:', propertyId)
      await markLeadCRMSyncSuccess(leadId, null, 'skipped', attempt)
      return { success: true, action: 'skipped' }
    }

    if (!integration.validated) {
      console.log('[CRM Sync] CRM mapping not validated, skipping sync')
      await markLeadCRMSyncSuccess(leadId, null, 'skipped', attempt)
      return { success: true, action: 'skipped' }
    }

    // Check if lead already exists
    const searchResult = await searchLeadInCRM(
      propertyId,
      leadData.email || '',
      leadData.phone
    )

    if (!searchResult.success) {
      return resolveCRMSyncFailure({
        leadId,
        attempt,
        error: searchResult.error || 'CRM search failed',
        retryable: Boolean(searchResult.retryable),
      })
    }

    if (searchResult.found && searchResult.externalId) {
      // Lead already exists - link to existing record
      await markLeadCRMSyncSuccess(leadId, searchResult.externalId, 'linked', attempt)
      return {
        success: true,
        action: 'linked',
        externalId: searchResult.externalId,
      }
    }

    // Create new lead in CRM
    const response = await fetch(`${DATA_ENGINE_URL}/crm/push-lead`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': DATA_ENGINE_API_KEY,
      },
      body: JSON.stringify({
        property_id: propertyId,
        lead_id: leadId,
        crm_type: integration.crmType,
        credentials: integration.credentials,
        lead_data: leadData,
        field_mapping: integration.fieldMapping,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[CRM Sync] Push failed:', errorText)
      return resolveCRMSyncFailure({
        leadId,
        attempt,
        error: normalizeCRMError(errorText, `CRM push failed (${response.status})`),
        retryable: isRetryableDataEngineStatus(response.status),
      })
    }

    const result = await response.json()

    if (result.success && result.external_id) {
      await markLeadCRMSyncSuccess(leadId, result.external_id, result.action, attempt)
      return {
        success: true,
        action: result.action,
        externalId: result.external_id,
      }
    } else {
      return resolveCRMSyncFailure({
        leadId,
        attempt,
        error: result.error || 'CRM provider returned an unsuccessful response',
        retryable: false,
      })
    }
  } catch (error) {
    console.error('[CRM Sync] Push error:', error)
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    return resolveCRMSyncFailure({
      leadId,
      attempt,
      error: errorMsg,
      retryable: true,
    })
  }
}

/**
 * Sync a lead to CRM (called after lead creation)
 * This is the main function to call from other parts of the app
 */
export async function syncLeadToCRM(
  propertyId: string,
  leadId: string,
  leadData: LeadData,
  options?: SyncLeadToCRMOptions
): Promise<CRMSyncResult> {
  console.log(`[CRM Sync] Syncing lead ${leadId} to CRM for property ${propertyId}`)
  
  const result = await pushLeadToCRM(propertyId, leadId, leadData, options)
  
  if (result.success) {
    console.log(`[CRM Sync] Lead synced successfully: ${result.action}`, result.externalId || '')
  } else {
    console.error(`[CRM Sync] Lead sync ${result.action}:`, result.error)
  }
  
  return result
}

export async function processPendingCRMSyncs(limit: number = 50): Promise<ProcessPendingCRMSyncsResult> {
  const supabase = createServiceClient()
  const result: ProcessPendingCRMSyncsResult = {
    processed: 0,
    succeeded: 0,
    scheduledRetries: 0,
    deadLettered: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  }
  const nowIso = new Date().toISOString()

  const { data: leads, error } = await supabase
    .from('leads')
    .select(`
      id,
      property_id,
      first_name,
      last_name,
      email,
      phone,
      source,
      status,
      move_in_date,
      bedrooms,
      notes,
      crm_sync_status,
      crm_sync_retry_count,
      crm_sync_next_retry_at
    `)
    .in('crm_sync_status', ['pending', 'retrying', 'failed', 'processing'])
    .or(`crm_sync_next_retry_at.is.null,crm_sync_next_retry_at.lte.${nowIso}`)
    .limit(limit)

  if (error) {
    console.error('[CRM Sync] Failed to fetch retry queue:', error)
    result.errors.push(error.message)
    return result
  }

  if (!leads?.length) {
    return result
  }

  for (const lead of leads as LeadCRMSyncRow[]) {
    const nextRetryMs = lead.crm_sync_next_retry_at ? Date.parse(lead.crm_sync_next_retry_at) : null
    const isDue = nextRetryMs === null || (Number.isFinite(nextRetryMs) && nextRetryMs <= Date.now())
    if (!isDue) {
      continue
    }

    const claimStartedAt = new Date()
    const claimStartedAtIso = claimStartedAt.toISOString()
    const leaseExpiresAtIso = new Date(
      claimStartedAt.getTime() + CRM_SYNC_PROCESSING_LEASE_MS
    ).toISOString()

    const { data: claimedLead, error: claimError } = await supabase
      .from('leads')
      .update({
        crm_sync_status: 'processing',
        crm_sync_error: null,
        crm_sync_next_retry_at: leaseExpiresAtIso,
        crm_dead_lettered_at: null,
      })
      .eq('id', lead.id)
      .eq('crm_sync_status', lead.crm_sync_status || 'pending')
      .eq('crm_sync_retry_count', lead.crm_sync_retry_count ?? 0)
      .or(`crm_sync_next_retry_at.is.null,crm_sync_next_retry_at.lte.${claimStartedAtIso}`)
      .select('id')
      .maybeSingle()

    if (claimError) {
      result.errors.push(`Lead ${lead.id}: failed to claim retry lease (${claimError.message})`)
      continue
    }

    if (!claimedLead?.id) {
      continue
    }

    result.processed += 1

    if (!lead.property_id) {
      result.deadLettered += 1
      const deadLetter = await deadLetterLeadCRMSync(
        lead.id,
        'Lead is missing property_id for CRM retry processing',
        (lead.crm_sync_retry_count ?? 0) + 1
      )
      if (deadLetter.error) {
        result.errors.push(`Lead ${lead.id}: ${deadLetter.error}`)
      }
      continue
    }

    const syncResult = await syncLeadToCRM(
      lead.property_id,
      lead.id,
      buildLeadDataFromRow(lead),
      {
        attempt: lead.crm_sync_retry_count ?? 0,
        preserveClaimLease: true,
      }
    )

    if (syncResult.success) {
      if (syncResult.action === 'skipped') {
        result.skipped += 1
      } else {
        result.succeeded += 1
      }
      continue
    }

    if (syncResult.action === 'retry_scheduled') {
      result.scheduledRetries += 1
    } else if (syncResult.action === 'dead_lettered') {
      result.deadLettered += 1
    } else {
      result.failed += 1
    }

    if (syncResult.error) {
      result.errors.push(`Lead ${lead.id}: ${syncResult.error}`)
    }
  }

  return result
}

