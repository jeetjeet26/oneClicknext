import { crmResponse, savedCRMRequest } from './client'

type SyncItem = { leadId: string; leadName: string; state: string; stale: boolean }
export type LeadSyncResult = { message: string; issues: string[] }
const reasons: Record<string, string> = {
  contact_required: 'Add an email address or phone number.',
  handoff_in_progress: 'A sync is already in progress.',
  legacy_link_review_required: 'The existing CRM link needs attention in CRM settings.',
  qualification_required: 'The CRM connection needs verification in settings.',
  configuration_required: 'Finish the CRM connection setup in settings.',
  payload_too_large: 'The lead details exceed the CRM size limit.',
  needs_reconciliation: 'The CRM response was unclear. Check its existing record before retrying.',
  failed: 'Sync stopped before sending. Check CRM settings.',
  cancelled: 'This sync was stopped.',
}

// One user click authorizes the selected leads. Keep the same saved selection until
// approval is confirmed, including after a lost response or page reload.
export async function syncLeadBatch(propertyId: string, leadIds: string[]): Promise<LeadSyncResult> {
  const ids = [...leadIds].sort()
  const request = await savedCRMRequest('lead-sync', { action: 'prepare', propertyId, leadIds: ids })
  const post = async (body: Record<string, unknown>) => crmResponse(await fetch('/api/crm/batches', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
  const prepared = await post(request.body)
  if (typeof prepared.batchId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(prepared.batchId)) {
    throw new Error('The sync request could not be confirmed. Try Sync to CRM again to check the same request.')
  }
  const batch = await crmResponse(await fetch('/api/crm/batches?' + new URLSearchParams({ propertyId, batchId: prepared.batchId })))
  if (batch.batchId !== prepared.batchId || !Array.isArray(batch.items) ||
      JSON.stringify(batch.items.map((item: SyncItem) => item.leadId).sort()) !== JSON.stringify(ids)) {
    throw new Error('The selected leads could not be confirmed. No new sync was authorized.')
  }
  const items: SyncItem[] = batch.items
  const queued = items.filter(item => item.state === 'queued').length
  if (queued && !batch.approved) {
    if (batch.deliveryPaused) throw new Error('CRM syncing is currently paused. Your leads have not been sent.')
    if (batch.stopped || !batch.canApproveOwnBatch || items.some(item => item.stale)) {
      throw new Error('The lead or CRM connection changed. Check the saved sync in CRM settings before retrying.')
    }
    if (typeof batch.manifestHash !== 'string' || !/^[a-f0-9]{64}$/.test(batch.manifestHash)) {
      throw new Error('The sync details could not be confirmed. No new sync was authorized.')
    }
    const approval = await savedCRMRequest('lead-sync-approve', {
      action: 'approve', propertyId, batchId: batch.batchId, manifestHash: batch.manifestHash,
    })
    const approved = await post(approval.body)
    if (approved.batchId !== batch.batchId || !['applied', 'replayed', 'already_recorded'].includes(approved.state)) {
      throw new Error('The sync result could not be confirmed. Try Sync to CRM again to check the same request.')
    }
    approval.acknowledge()
  }
  request.acknowledge()
  const linked = items.filter(item => item.state === 'already_linked').length
  const confirmed = items.filter(item => item.state === 'confirmed').length
  const active = items.filter(item => ['searching', 'sending'].includes(item.state)).length
  const messages = [queued ? `${queued} queued for CRM sync.` : '', linked ? `${linked} already in CRM; no duplicate created. This does not send new conversation notes.` : '', confirmed ? `${confirmed} confirmed in CRM.` : '', active ? `${active} already syncing.` : ''].filter(Boolean)
  const issues = items.filter(item => !['queued', 'already_linked', 'confirmed', 'searching', 'sending'].includes(item.state))
    .map(item => `${item.leadName || 'Lead'}: ${reasons[item.state] || 'This lead needs attention in CRM settings.'}`)
  return { message: messages.join(' ') || 'No leads were sent.', issues }
}
