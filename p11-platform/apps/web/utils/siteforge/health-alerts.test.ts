import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient: vi.fn() }))
import { deliverPendingHealthAlerts } from './health-alerts'
import { IncidentAlertDeliveryError } from './incident-alerts'
import type { createServiceClient } from '@/utils/supabase/admin'
const input = { incidentIds: ['incident'], summary: { processed: 1, failed: 0, unhealthy: 1,
  degraded: 0, staleJobsRecovered: null, restoreDrills: { failed: 0, awaitingOperator: 0 } } }
function fixture(failClaim = false, failFinalSave = false) {
  const incident = { id: 'incident', org_id: 'org', updated_at: 'prior', evidence: {
    notification: { version: 1, state: 'pending', severity: 'high' } as Record<string, unknown> } }
  let writes = 0
  const service = { from: () => {
    let update: typeof incident | undefined
    const query = { select: () => query, in: () => query, neq: () => query, eq: () => query,
      update: (value: typeof incident) => { update = value; return query },
      maybeSingle: async () => {
        writes++
        if (failClaim || (failFinalSave && writes === 2)) return { data: null, error: { message: 'write unavailable' } }
        if (update) Object.assign(incident, update)
        return { data: { id: incident.id }, error: null }
      },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [structuredClone(incident)], error: null })),
    }
    return query
  } } as unknown as ReturnType<typeof createServiceClient>
  return { service, incident }
}
beforeEach(() => vi.stubEnv('OUTBOUND_DELIVERY_PAUSED', 'false'))
afterEach(() => vi.unstubAllEnvs())
it('retains a confirmed rejection as blocked and never sends it again automatically', async () => {
  const { service, incident } = fixture()
  const send = vi.fn().mockRejectedValue(new IncidentAlertDeliveryError('blocked', 'sender_domain_unverified'))
  expect(await deliverPendingHealthAlerts(input, service, send)).toMatchObject({ held: 1, accepted: 0 })
  expect(incident.evidence.notification).toMatchObject({ state: 'blocked', failureCode: 'sender_domain_unverified' })
  expect(await deliverPendingHealthAlerts(input, service, send)).toMatchObject({ held: 1, accepted: 0 })
  expect(send).toHaveBeenCalledTimes(1)
})
it('sanitizes an ambiguous provider exception and retains it for review', async () => {
  const { service, incident } = fixture()
  const send = vi.fn().mockRejectedValue(new Error('https://provider.test?token=private manager@example.test'))
  expect(await deliverPendingHealthAlerts(input, service, send)).toMatchObject({ held: 1 })
  expect(incident.evidence.notification).toMatchObject({ state: 'unconfirmed', failureCode: 'acceptance_unconfirmed' })
  expect(JSON.stringify(incident)).not.toMatch(/private|manager@example/)
  await deliverPendingHealthAlerts(input, service, send); expect(send).toHaveBeenCalledTimes(1)
})
it('never sends without a saved claim', async () => {
  const { service } = fixture(true); const send = vi.fn()
  await expect(deliverPendingHealthAlerts(input, service, send)).rejects.toThrow('claim')
  expect(send).not.toHaveBeenCalled()
})
it('keeps a provider-accepted but unsaved receipt held without repeating delivery', async () => {
  const { service, incident } = fixture(false, true)
  const send = vi.fn().mockResolvedValue({ recipients: 1, messageIds: ['message'] })
  expect(await deliverPendingHealthAlerts(input, service, send)).toMatchObject({ held: 1, accepted: 0 })
  expect(incident.evidence.notification.state).toBe('claimed')
  await deliverPendingHealthAlerts(input, service, send); expect(send).toHaveBeenCalledTimes(1)
})
