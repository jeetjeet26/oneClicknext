import { createServiceClient } from '@/utils/supabase/admin'
import { MarketStoreError } from './decision-store'
import { acquirePublicSource } from './source-provider'
import { requestExtraction } from './extraction-store'
import type { capturedExtraction } from './source-contracts'
import type { z } from 'zod'

type Value = Record<string, unknown>
const allowed = ['ready', 'queued', 'running', 'received', 'held', 'stopped', 'busy', 'fetch_once', 'saved', 'replayed']
const messages: Record<string, string> = {
  forbidden: 'This property is unavailable.', not_found: 'This saved source request is unavailable in the selected property.',
  stale_competitor: 'Competitor details changed. Reload the current source before requesting a fetch.',
  competitor_archived: 'Restore this competitor before requesting a source.', source_required: 'Save the selected source URL before requesting a fetch.',
  stale_request: 'This source request changed. Reload its saved status.', closed_request: 'This source request is already closed.',
  request_conflict: 'This decision differs from its saved request. Inspect its history.', cursor_changed: 'Reload source history before loading another page.',
}
export async function sourceRpc(name: string, args: Value) {
  const db = createServiceClient() as unknown as { rpc: (name: string, args: Value) => Promise<{ data: Value | null; error: unknown }> }
  const { data, error } = await db.rpc(name, args)
  if (error || !data) throw new MarketStoreError('The source decision could not be confirmed. Retry the same decision or inspect saved history.')
  if (!allowed.includes(String(data.state))) throw new MarketStoreError(messages[String(data.state)] || 'Review the current saved source before continuing.', data.state === 'forbidden' ? 403 : data.state === 'not_found' ? 404 : 409)
  return data
}
export function sourceExecutionStatus() { return { paused: process.env.OUTBOUND_DELIVERY_PAUSED === 'true' } }
export async function runSource(id: string) {
  if (sourceExecutionStatus().paused) return { state: 'paused' }
  const claim = await sourceRpc('claim_marketvision_source', { p_id: id })
  if (claim.state !== 'fetch_once') return claim
  const receipt = await acquirePublicSource(String(claim.sourceUrl))
  const args = { p_id: id, p_claim_token: claim.claimToken, p_result: receipt }
  // Retry only persistence of the exact retained receipt; never repeat the fetch.
  try { return await sourceRpc('record_marketvision_source_result', args) }
  catch { return sourceRpc('record_marketvision_source_result', args) }
}
export async function requestCapturedExtraction(input: z.infer<typeof capturedExtraction>, actor: string) {
  const read = await sourceRpc('read_marketvision_sources', { p_property_id: input.propertyId, p_actor_id: actor, p_competitor_id: input.competitorId, p_request_id: input.sourceId })
  const source = read.request as { version: number; state: string; source_snapshot: { version: number }; receipt: { text: string; finalUrl: string } | null }
  if (source.version !== input.expectedVersion) throw new MarketStoreError(messages.stale_request, 409)
  if (source.state !== 'received' || !source.receipt) throw new MarketStoreError('A retained readable page is required before extraction.', 409)
  return requestExtraction({ requestId: input.requestId, propertyId: input.propertyId, competitorId: input.competitorId,
    sourceVersion: source.source_snapshot.version, sourceRequestId: input.sourceId, confirmedSourceScope: true,
    content: source.receipt.text, sourceUrl: source.receipt.finalUrl, effectiveAt: null, reason: input.reason }, actor)
}
