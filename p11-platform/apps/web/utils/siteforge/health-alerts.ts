import type { Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { isDeliveryPaused } from '@/utils/services/delivery-guard'
import { IncidentAlertDeliveryError, sendSiteForgeIncidentAlert } from './incident-alerts'
import { incidentAlertFailureMessage, recordObject } from './health-alert-state'

/** A durable claim precedes delivery. Unconfirmed outcomes require operator review. */
export async function deliverPendingHealthAlerts(
  input: { incidentIds: string[]; summary: Parameters<typeof sendSiteForgeIncidentAlert>[0]['summary'] },
  service = createServiceClient(),
  send = sendSiteForgeIncidentAlert,
) {
  const result = { accepted: 0, held: 0, skipped: 0, paused: isDeliveryPaused() }
  if (!input.incidentIds.length || result.paused) return result
  const { data: incidents, error } = await service.from('siteforge_incidents')
    .select('id, org_id, evidence, updated_at').in('id', [...new Set(input.incidentIds)])
    .neq('status', 'resolved')
  if (error) throw new Error(`Pending incident alerts could not be read: ${error.message}`)
  for (const incident of incidents || []) {
    const evidence = recordObject(incident.evidence)
    const notification = recordObject(evidence.notification)
    if (notification.version !== 1 || notification.state !== 'pending') {
      if (['claimed', 'unconfirmed', 'blocked'].includes(String(notification.state))) result.held++
      else result.skipped++
      continue
    }
    const claimedAt = new Date().toISOString()
    const claimed = { ...notification, state: 'claimed', claimedAt }
    const claim = await service.from('siteforge_incidents').update({
      evidence: { ...evidence, notification: claimed } as Json, updated_at: claimedAt,
    }).eq('id', incident.id).eq('updated_at', incident.updated_at).neq('status', 'resolved')
      .select('id').maybeSingle()
    if (claim.error) throw new Error(`Incident alert claim could not be saved: ${claim.error.message}`)
    if (!claim.data) { result.skipped++; continue }
    let outcome: Record<string, Json | undefined>
    try {
      const accepted = await send({ orgIds: [incident.org_id],
        runId: `incident-${incident.id}-${notification.severity}`, summary: input.summary })
      outcome = { ...claimed, state: 'accepted', messageIds: accepted.messageIds,
        acceptedAt: new Date().toISOString(), receiptVerified: false }
    } catch (cause) {
      const failureCode = cause instanceof IncidentAlertDeliveryError ? cause.code : 'acceptance_unconfirmed'
      outcome = { ...claimed, state: cause instanceof IncidentAlertDeliveryError ? cause.state : 'unconfirmed',
        failureCode, error: incidentAlertFailureMessage(failureCode) }

    }
    const saved = await service.from('siteforge_incidents').update({
      evidence: { ...evidence, notification: outcome } as Json, updated_at: new Date().toISOString(),
    }).eq('id', incident.id).eq('updated_at', claimedAt).neq('status', 'resolved').select('id').maybeSingle()
    // A concurrent edit or failed save leaves the durable claim in place; never resend blindly.
    if (saved.error || !saved.data || outcome.state !== 'accepted') result.held++
    else result.accepted++
  }
  return result
}
