import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const d = vi.hoisted(() => ({ service: vi.fn(), send: vi.fn(), user: vi.fn(), profiles: vi.fn() }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient: d.service }))
vi.mock('resend', () => ({ Resend: class { batch = { send: d.send } } }))
import { sendSiteForgeIncidentAlert } from './incident-alerts'
const input = { orgIds: ['organization'], runId: 'incident-fixture', summary: {
  processed: 1, failed: 0, unhealthy: 1, degraded: 0, staleJobsRecovered: null,
  restoreDrills: { failed: 0, awaitingOperator: 0 },
} }
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('OUTBOUND_DELIVERY_PAUSED', 'false')
  vi.stubEnv('RESEND_API_KEY', 're_fixture')
  vi.stubEnv('RESEND_FROM_EMAIL', 'Alerts <alerts@example.test>')
  const query = { select: vi.fn(), in: vi.fn() }
  query.select.mockReturnValue(query)
  query.in.mockImplementation((_column, values) => values.includes('admin') ? d.profiles() : query)
  d.profiles.mockResolvedValue({ data: [{ id: 'manager' }], error: null })
  d.service.mockReturnValue({ from: () => query, auth: { admin: { getUserById: d.user } } })
  d.user.mockResolvedValue({ data: { user: { email: 'manager@example.test' } }, error: null })
  d.send.mockResolvedValue({ data: { data: [{ id: 'email-fixture' }] }, error: null })
})
afterEach(() => vi.unstubAllEnvs())
describe('incident alert acceptance', () => {
  it('uses one strictly validated batch and a stable idempotency key', async () => {
    expect(await sendSiteForgeIncidentAlert(input)).toEqual({ recipients: 1, messageIds: ['email-fixture'] })
    expect(d.send).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ to: 'manager@example.test' })],
      { idempotencyKey: 'siteforge-health/incident-fixture', batchValidation: 'strict' })
  })
  it('does not send while delivery is paused', async () => {
    vi.stubEnv('OUTBOUND_DELIVERY_PAUSED', 'true')
    await expect(sendSiteForgeIncidentAlert(input)).rejects.toThrow()
    expect(d.service).not.toHaveBeenCalled(); expect(d.send).not.toHaveBeenCalled()
  })
  it('records missing sender setup as blocked before looking up recipients', async () => {
    vi.stubEnv('RESEND_FROM_EMAIL', '')
    await expect(sendSiteForgeIncidentAlert(input)).rejects.toMatchObject({ state: 'blocked', code: 'delivery_not_configured' })
    expect(d.service).not.toHaveBeenCalled(); expect(d.send).not.toHaveBeenCalled()
  })
  it('does not silently omit a manager whose account lookup failed', async () => {
    d.profiles.mockResolvedValue({ data: [{ id: 'a' }, { id: 'b' }], error: null })
    d.user.mockResolvedValueOnce({ data: { user: null }, error: { message: 'private provider response' } })
    await expect(sendSiteForgeIncidentAlert(input)).rejects.toMatchObject({ state: 'blocked', code: 'recipients_unavailable' })
    expect(d.send).not.toHaveBeenCalled()
  })
  it('requires an available manager email', async () => {
    d.user.mockResolvedValue({ data: { user: {} }, error: null })
    await expect(sendSiteForgeIncidentAlert(input)).rejects.toMatchObject({ state: 'blocked', code: 'recipients_missing' })
    expect(d.send).not.toHaveBeenCalled()
  })
  it('deduplicates manager addresses without exposing them to each other', async () => {
    d.profiles.mockResolvedValue({ data: [{ id: 'a' }, { id: 'b' }], error: null })
    expect((await sendSiteForgeIncidentAlert(input)).recipients).toBe(1)
    expect(d.send.mock.calls[0][0]).toHaveLength(1)
  })
  it('does not split an oversized recipient set into unrecorded sends', async () => {
    d.profiles.mockResolvedValue({ data: Array.from({ length: 101 }, (_, id) => ({ id: String(id) })), error: null })
    d.user.mockImplementation(async id => ({ data: { user: { email: `manager${id}@example.test` } }, error: null }))
    await expect(sendSiteForgeIncidentAlert(input)).rejects.toMatchObject({ state: 'blocked', code: 'recipients_limit' })
    expect(d.send).not.toHaveBeenCalled()
  })
  it('recognizes the observed unverified-domain rejection without retaining raw provider text', async () => {
    d.send.mockResolvedValue({ data: null, error: { statusCode: 403, name: 'validation_error',
      message: 'The domain private.example is not verified. Please add it at https://provider.test/private-token' } })
    const error = await sendSiteForgeIncidentAlert(input).catch(value => value)
    expect(error).toMatchObject({ state: 'blocked', code: 'sender_domain_unverified' })
    expect(error.message).not.toMatch(/private|provider.test/)
    expect(d.send).toHaveBeenCalledTimes(1)
  })
  it.each([401, 403, 422])('holds an explicit provider rejection (%s)', async statusCode => {
    d.send.mockResolvedValue({ data: null, error: { statusCode, name: 'validation_error', message: 'private details' } })
    await expect(sendSiteForgeIncidentAlert(input)).rejects.toMatchObject({ state: 'blocked' })
    expect(d.send).toHaveBeenCalledTimes(1)
  })
  it.each([409, 429, 500, null])('does not turn uncertain acceptance (%s) into a safe retry', async statusCode => {
    d.send.mockResolvedValue({ data: null, error: { statusCode, name: 'application_error', message: 'private details' } })
    await expect(sendSiteForgeIncidentAlert(input)).rejects.toMatchObject({ state: 'unconfirmed', code: 'acceptance_unconfirmed' })
    expect(d.send).toHaveBeenCalledTimes(1)
  })
  it.each([null, { data: [] }, { data: [{ id: '' }] }])('requires complete provider message receipts: %j', async data => {
    d.send.mockResolvedValue({ data, error: null })
    await expect(sendSiteForgeIncidentAlert(input)).rejects.toMatchObject({ state: 'unconfirmed' })
  })
  it('rejects duplicate message receipts for different recipients', async () => {
    d.profiles.mockResolvedValue({ data: [{ id: 'a' }, { id: 'b' }], error: null })
    d.user.mockImplementation(async id => ({ data: { user: { email: `${id}@example.test` } }, error: null }))
    d.send.mockResolvedValue({ data: { data: [{ id: 'same' }, { id: 'same' }] }, error: null })
    await expect(sendSiteForgeIncidentAlert(input)).rejects.toMatchObject({ state: 'unconfirmed' })
  })
})
