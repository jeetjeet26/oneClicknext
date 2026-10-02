import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ client: vi.fn(), start: vi.fn(), finish: vi.fn(), google: vi.fn(), meta: vi.fn(), executor: vi.fn() }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient: mocks.client }))
vi.mock('@/utils/services/cron-job-runs', async importOriginal => ({
  ...await importOriginal<typeof import('@/utils/services/cron-job-runs')>(),
  startCronJobRun: mocks.start, finishCronJobRun: mocks.finish,
}))
vi.mock('@/app/api/integrations/google-ads/sync/route', () => ({ syncGoogleAdsConnection: mocks.google }))
vi.mock('@/app/api/integrations/meta-ads/sync/route', () => ({ syncMetaAdsConnection: mocks.meta }))
vi.mock('@/utils/services/shared-executor', () => ({ runSharedExecutorJob: mocks.executor }))
import { GET } from './route'

const google = { id: 'google-1', property_id: 'property-1', org_id: 'org-1', platform: 'google_ads', account_id: '123' }
const meta = { ...google, id: 'meta-1', platform: 'meta_ads', account_id: '456' }
const recorded: string[] = []
const request = (token = 'expected-secret') => new NextRequest('http://localhost/api/cron/sync-ads', { headers: { authorization: `Bearer ${token}` } })
function connections(data: unknown[], error: unknown = null, count: number | null = data.length) {
  mocks.client.mockReturnValue({ from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data, error, count }) })) })) })
}

describe('scheduled ad sync outcomes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('CRON_SECRET', 'expected-secret')
    recorded.length = 0
    mocks.start.mockResolvedValue({ id: 'run-1', jobName: 'sync-ads', startedAtMs: 0 })
    mocks.finish.mockResolvedValue(undefined)
    mocks.executor.mockImplementation(async ({ execute }: { execute: () => Promise<unknown> }) => {
      try { const value = await execute(); recorded.push('succeeded'); return value }
      catch (error) { recorded.push('failed'); throw error }
    })
    connections([google, meta])
    mocks.google.mockResolvedValue({ synced: 7 })
    mocks.meta.mockResolvedValue({ synced: 4 })
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it.each(['', 'wrong-secret'])('rejects a missing or incorrect secret before recording or executing', async secret => {
    if (!secret) vi.stubEnv('CRON_SECRET', '')
    expect((await GET(request(secret || 'expected-secret'))).status).toBe(401)
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.client).not.toHaveBeenCalled()
    expect(mocks.executor).not.toHaveBeenCalled()
  })
  it('does not sync without a durable cron run', async () => {
    mocks.start.mockResolvedValue(null)
    expect((await GET(request())).status).toBe(503)
    expect(mocks.client).not.toHaveBeenCalled()
    expect(mocks.google).not.toHaveBeenCalled()
  })
  it('reports durable dispatch as queued work, without claiming provider imports are complete', async () => {
    mocks.google.mockResolvedValue({ synced: 0, accepted: true, jobId: 'google-job' })
    mocks.meta.mockResolvedValue({ synced: 0, accepted: true, jobId: 'meta-job' })
    const response = await GET(request())
    expect(await response.json()).toMatchObject({ success: true, totalQueued: 2, totalSynced: 0 })
    expect(mocks.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ summary: expect.objectContaining({ totalQueued: 2, totalSynced: 0 }) }))
  })
  it('does not run a silently truncated account inventory', async () => {
    connections([google], null, 1001)
    expect((await GET(request())).status).toBe(503)
    expect(mocks.google).not.toHaveBeenCalled(); expect(mocks.executor).not.toHaveBeenCalled()
  })
  it('records an empty schedule accurately', async () => {
    connections([])
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ message: 'No connections to sync', synced: 0 })
    expect(mocks.executor).not.toHaveBeenCalled()
    expect(mocks.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'success', summary: { totalConnections: 0, totalSynced: 0, failures: 0 } }))
  })
  it('records success only when all providers succeed, including a valid zero-row sync', async () => {
    mocks.google.mockResolvedValue({ synced: 0 })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, status: 'success', totalSynced: 4, failures: 0 })
    expect(recorded).toEqual(['succeeded', 'succeeded'])
  })
  it('retries transient failures and records mixed results as partial in both response and cron history', async () => {
    mocks.google.mockResolvedValueOnce({ synced: 0, error: 'Temporary outage', retryable: true }).mockResolvedValueOnce({ synced: 7 })
    mocks.meta.mockResolvedValue({ synced: 0, error: 'Bad credentials', retryable: false })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: false, status: 'partial', totalSynced: 7, failures: 1, permanentFailures: 1 })
    expect(mocks.google).toHaveBeenCalledTimes(2)
    expect(mocks.meta).toHaveBeenCalledTimes(1)
    expect(recorded).toEqual(['succeeded', 'failed'])
    expect(mocks.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'partial' }))
    expect(mocks.executor).toHaveBeenCalledWith(expect.objectContaining({ domain: 'cron.sync-ads', propertyId: 'property-1', orgId: 'org-1', dedupeKey: 'run-1:google-1' }))
  })
  it('returns failure when every account fails', async () => {
    mocks.google.mockResolvedValue({ synced: 0, error: 'Unauthorized', retryable: false })
    mocks.meta.mockResolvedValue({ synced: 0, error: 'Unavailable', retryable: false })
    const response = await GET(request())
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ success: false, status: 'failed', totalSynced: 0, failures: 2 })
    expect(recorded).toEqual(['failed', 'failed'])
    expect(mocks.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'failed' }))
  })
  it('retains rows imported before a batch failure as a partial result', async () => {
    connections([google])
    mocks.google.mockResolvedValue({ synced: 3, error: 'Second batch failed', retryable: false })
    const response = await GET(request())
    expect(await response.json()).toMatchObject({ success: false, status: 'partial', totalSynced: 3, failures: 1 })
    expect(recorded).toEqual(['failed'])
  })
  it('preserves partial writes instead of obscuring them with an automatic retry', async () => {
    connections([google])
    mocks.google.mockResolvedValueOnce({ synced: 3, error: 'Second batch temporarily unavailable', retryable: true }).mockResolvedValueOnce({ synced: 0, error: 'Provider unavailable', retryable: false })
    const response = await GET(request())
    expect(await response.json()).toMatchObject({ status: 'partial', totalSynced: 3, retryableFailures: 1 })
    expect(mocks.google).toHaveBeenCalledTimes(1)
  })
  it('continues independent accounts after an unexpected failure', async () => {
    mocks.google.mockRejectedValue(new Error('Unexpected provider exception'))
    const response = await GET(request())
    expect(await response.json()).toMatchObject({ success: false, status: 'partial', totalSynced: 4 })
    expect(mocks.meta).toHaveBeenCalledTimes(1)
    expect(recorded).toEqual(['failed', 'succeeded'])
  })
  it('does not bypass the ledger when ownership is missing', async () => {
    connections([{ ...google, org_id: null }])
    expect((await GET(request())).status).toBe(502)
    expect(mocks.google).not.toHaveBeenCalled()
    expect(mocks.executor).not.toHaveBeenCalled()
  })
  it('records a database query failure without starting provider calls', async () => {
    connections([], { message: 'Database failure' })
    expect((await GET(request())).status).toBe(500)
    expect(mocks.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'failed' }))
    expect(mocks.executor).not.toHaveBeenCalled()
  })
})
