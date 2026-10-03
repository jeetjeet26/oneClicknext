import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ from: vi.fn(), fetch: vi.fn() }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient: () => ({ from: mocks.from }) }))
vi.mock('@/utils/services/runtime-config', () => ({ getDataEngineUrl: () => 'http://localhost:8000' }))
vi.mock('node:crypto', () => ({ randomUUID: () => 'job' }))
import { queueAdConnection } from './queue-ad-connection'
let connection: unknown, job: unknown
const queue = () => queueAdConnection('google_ads', 'connection', 'account', 'property', 7)
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('DATA_ENGINE_API_KEY', 'test-only'); vi.stubGlobal('fetch', mocks.fetch)
  connection = { id: 'connection' }
  job = { id: 'job', property_id: 'property', recovery_version: 1, channels: ['google_ads'], connection_ids: ['connection'], date_range: 'LAST_7_DAYS' }
  mocks.from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {}; chain.select = chain.eq = vi.fn(() => chain)
    chain.maybeSingle = vi.fn(async () => ({ data: table === 'import_jobs' ? job : connection, error: null })); return chain
  })
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'accepted', job_id: 'job', property_id: 'property' }) })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('tracked connection imports', () => {
  it('acknowledges durable acceptance without claiming rows were imported', async () => {
    await expect(queue()).resolves.toEqual({ synced: 0, accepted: true, jobId: 'job' })
    const [url, request] = mocks.fetch.mock.calls[0]
    expect(url).toBe('http://localhost:8000/sync-marketing-data')
    expect(JSON.parse(request.body)).toEqual({ job_id: 'job', property_id: 'property', channels: ['google_ads'], connection_ids: ['connection'], date_range: 'LAST_7_DAYS' })
    expect(request.headers.Authorization).toBe('Bearer test-only')
  })
  it('stops before network access when the account does not belong to the property', async () => {
    connection = null; expect((await queue()).accepted).toBeUndefined(); expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('requires backend credentials before requesting an import', async () => {
    vi.stubEnv('DATA_ENGINE_API_KEY', ''); expect((await queue()).retryable).toBe(false); expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('rejects an unrecorded or mismatched accepted job', async () => {
    job = { ...(job as object), connection_ids: ['another-account'] }
    await expect(queue()).resolves.toMatchObject({ synced: 0, jobId: 'job', retryable: false, error: expect.stringContaining('before retrying') })
  })
  it('retains job identity when a response is lost', async () => {
    mocks.fetch.mockRejectedValue(new Error('lost response'))
    await expect(queue()).resolves.toMatchObject({ synced: 0, jobId: 'job', retryable: false })
  })
  it('rejects an unknown date range without dispatching', async () => {
    await expect(queueAdConnection('meta_ads', 'connection', 'account', 'property', 90)).resolves.toMatchObject({ synced: 0, retryable: false })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
