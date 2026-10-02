import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

export const leadpulseHeaders = { 'Cache-Control': 'no-store' }
export function reply(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: leadpulseHeaders }) }
export async function leadpulseRpc(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const client = createServiceClient()
  const rpcClient = client as unknown as {rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: Record<string, unknown> | null; error: unknown }>}
  const { data, error } = await rpcClient.rpc(name, args)
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('LeadPulse could not confirm the saved result')
  return data
}
export function resultReply(result: Record<string, unknown>) {
  const success = ['saved', 'unscored', 'applied', 'replayed', 'running', 'completed', 'cancelled'].includes(String(result.state))
  const messages: Record<string, string> = {
    stale_score: 'This lead has a newer score. Reload its saved score before reviewing.',
    busy: 'A scoring run is already open. Check its saved progress before starting another.',
    request_conflict: 'This request differs from the saved request. Review the saved result before starting again.',
    target_conflict: 'The selected leads no longer belong to this property. Reload the list.',
    legacy_conflict: 'An older engagement record uses this identity. Review it before recording another event.',
    owner_required: 'The person who started this run can continue it. A teammate can stop the remaining work.',
    rules_changed: 'The scoring rules changed. Stop this run and start a new one.',
    use_tour_workflow: 'Record tour outcomes from the lead’s tour controls.',
    not_reported: 'Only staff-reported engagement can be withdrawn here.',
    already_corrected: 'This engagement was already withdrawn. Reload its history.',
  }
  return reply(success ? result : { ...result, error: messages[String(result.state)] || 'The requested record is unavailable.' }, success ? 200 : result.state === 'forbidden' ? 403 : result.state === 'not_found' ? 404 : 409)
}
export async function leadpulseUser() {
  const client = await createClient()
  const { data: { user }, error } = await client.auth.getUser()
  return error ? null : user
}
export async function leadpulseScope(userId: string, input: { leadId?: string; leadIds?: string[]; propertyId?: string }) {
  const client = createServiceClient()
  let propertyId = input.propertyId
  if (input.leadId || input.leadIds) {
    const ids = input.leadId ? [input.leadId] : input.leadIds!
    const { data, error } = await client.from('leads').select('id,property_id').in('id', ids)
    if (error) throw error
    if (!data || data.length !== ids.length || data.some(lead => !lead.property_id)) return { response: reply({ error: 'Lead not found' }, 404) }
    const properties = [...new Set(data.map(lead => lead.property_id!))]
    if (properties.length !== 1 || (propertyId && propertyId !== properties[0])) return { response: reply({ error: 'Choose leads from one matching property.' }, 400) }
    propertyId = properties[0]
  }
  if (!propertyId) return { response: reply({ error: 'A property is required.' }, 400) }
  const access = await validatePropertyAccess(userId, propertyId)
  if (!access.authorized) return { response: reply({ error: 'Forbidden' }, 403) }
  return { propertyId }
}
export function unconfirmed() { return reply({ error: 'The result could not be confirmed. Check the saved result or retry this same request.' }, 503) }
