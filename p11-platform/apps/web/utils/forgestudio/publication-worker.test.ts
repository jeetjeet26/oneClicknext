import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdapterError, type SocialAdapter } from './adapters/types'

/**
 * Table-driven Supabase mock (same pattern as content-store.test.ts) plus an
 * rpc mock for claim_shared_jobs / heartbeat_shared_job.
 */
type QueryResponse = { data: unknown; error: unknown }

const tableResponses: Record<string, QueryResponse[]> = {}
const callLog: Array<{ table: string; method: string; args: unknown[] }> = []
const rpcMock = vi.fn()

function nextResponse(table: string): QueryResponse {
  const queue = tableResponses[table] ?? []
  if (queue.length === 0) return { data: null, error: null }
  return queue.length > 1 ? queue.shift()! : queue[0]
}

function createBuilder(table: string) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'limit']) {
    builder[method] = vi.fn((...args: unknown[]) => {
      callLog.push({ table, method, args })
      return builder
    })
  }
  builder.single = vi.fn(async () => nextResponse(table))
  builder.maybeSingle = vi.fn(async () => nextResponse(table))
  builder.then = (
    resolve: (value: QueryResponse) => unknown,
    reject: (reason: unknown) => unknown
  ) => Promise.resolve(nextResponse(table)).then(resolve, reject)
  return builder
}

const fromMock = vi.fn((table: string) => createBuilder(table))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => ({ from: fromMock, rpc: rpcMock }),
}))

vi.mock('@/utils/forgestudio/crypto', () => ({
  decryptSecret: (value: string) => value.replace(/^enc:/, ''),
  encryptSecret: (value: string) => `enc:${value}`,
}))

vi.mock('@/utils/forgestudio/social-config', () => ({
  getSocialAppCredentials: vi.fn(async () => ({ appId: 'app-id', appSecret: 'app-secret' })),
}))

// Controllable fake adapter registry.
const fakeAdapter = {
  platform: 'facebook' as const,
  preflight: vi.fn<NonNullable<SocialAdapter['preflight']>>(),
  publish: vi.fn<SocialAdapter['publish']>(),
  reconcile: vi.fn<NonNullable<SocialAdapter['reconcile']>>(),
  refreshToken: vi.fn<NonNullable<SocialAdapter['refreshToken']>>(),
} satisfies SocialAdapter
let channelEnabled = true

vi.mock('@/utils/forgestudio/adapters', async () => {
  const actual = await vi.importActual<typeof import('./adapters/types')>('./adapters/types')
  return {
    ...actual,
    getAdapter: (platform: string) => (platform === 'facebook' ? fakeAdapter : null),
    isChannelEnabled: () => channelEnabled,
    normalizePlatform: (platform: string) => (platform === 'twitter' ? 'x' : platform),
  }
})

function setResponses(table: string, responses: QueryResponse[]) {
  tableResponses[table] = responses
}

function updatesFor(table: string) {
  return callLog.filter((entry) => entry.table === table && entry.method === 'update')
}

const JOB = {
  id: 'job-1',
  domain: 'forgestudio.publication',
  subject_id: 'pub-1',
  payload: { revisionId: 'rev-1', connectionId: 'conn-1' },
  attempt_count: 1,
  max_attempts: 3,
}

const PUBLICATION = {
  id: 'pub-1',
  org_id: 'org-1',
  property_id: 'prop-1',
  package_id: 'pkg-1',
  revision_id: 'rev-1',
  variant_id: 'var-1',
  connection_id: 'conn-1',
  platform: 'facebook',
  status: 'queued',
  scheduled_for: new Date().toISOString(),
}

const VARIANT = {
  id: 'var-1',
  caption: 'Hello world',
  hashtags: [],
  call_to_action: null,
  link_url: null,
  media_urls: [],
  alt_text: null,
  content_format: 'text',
  platform_options: {},
}

const CONNECTION = {
  id: 'conn-1',
  property_id: 'prop-1',
  platform: 'facebook',
  account_id: 'acct-1',
  access_token: 'enc:token',
  refresh_token: null,
  token_expires_at: null,
  page_id: 'page-1',
  page_access_token: 'enc:page-token',
  error_count: 0,
}

function primeHappyTables(overrides: {
  publication?: Partial<typeof PUBLICATION>
  attemptInsertError?: unknown
} = {}) {
  setResponses('social_publications', [
    { data: { ...PUBLICATION, ...(overrides.publication ?? {}) }, error: null },
    { data: null, error: null }, // status updates + sibling query fall through
  ])
  setResponses('social_content_variants', [{ data: VARIANT, error: null }])
  setResponses('social_connections', [{ data: CONNECTION, error: null }])
  setResponses('social_publication_attempts', [
    { data: { id: 'attempt-1' }, error: overrides.attemptInsertError ?? null },
  ])
  setResponses('shared_jobs', [{ data: null, error: null }])
  setResponses('social_content_packages', [{ data: null, error: null }])
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(tableResponses)) delete tableResponses[key]
  callLog.length = 0
  channelEnabled = true
  fakeAdapter.preflight.mockReset()
  fakeAdapter.publish.mockReset()
  fakeAdapter.reconcile.mockReset()
  fakeAdapter.refreshToken.mockReset()
  fakeAdapter.refreshToken.mockResolvedValue(null)
  rpcMock.mockReset()
  rpcMock.mockResolvedValue({ data: [], error: null })
})

async function runWorker() {
  const { processDuePublications } = await import('./publication-worker')
  return processDuePublications({ workerId: 'test-worker' })
}

describe('processDuePublications', () => {
  it('claims atomically via claim_shared_jobs and returns empty when nothing is due', async () => {
    const run = await runWorker()
    expect(run).toEqual({ claimed: 0, results: [] })
    expect(rpcMock).toHaveBeenCalledWith(
      'claim_shared_jobs',
      expect.objectContaining({ p_domain: 'forgestudio.publication', p_worker: 'test-worker' })
    )
  })

  it('publishes a due job and marks publication + job succeeded', async () => {
    rpcMock.mockImplementation(async (fn: string) =>
      fn === 'claim_shared_jobs' ? { data: [JOB], error: null } : { data: null, error: null }
    )
    primeHappyTables()
    fakeAdapter.publish.mockResolvedValue({
      providerPostId: 'fb-123',
      providerPostUrl: 'https://facebook.com/fb-123',
    })

    const run = await runWorker()

    expect(run.claimed).toBe(1)
    expect(run.results[0].outcome).toBe('published')
    expect(fakeAdapter.publish).toHaveBeenCalledTimes(1)
    // Publication marked published with provider IDs.
    const pubUpdates = updatesFor('social_publications').map((u) => u.args[0]) as Array<
      Record<string, unknown>
    >
    expect(pubUpdates.some((u) => u.status === 'published' && u.remote_post_id === 'fb-123')).toBe(true)
    // Job finished as succeeded.
    const jobUpdates = updatesFor('shared_jobs').map((u) => u.args[0]) as Array<Record<string, unknown>>
    expect(jobUpdates.some((u) => u.lifecycle_status === 'succeeded')).toBe(true)
  })

  it('requeues on retryable failure with backoff and resets publication to queued', async () => {
    rpcMock.mockImplementation(async (fn: string) =>
      fn === 'claim_shared_jobs' ? { data: [JOB], error: null } : { data: null, error: null }
    )
    primeHappyTables()
    fakeAdapter.publish.mockRejectedValue(new AdapterError('rate limited', 'retryable'))

    const run = await runWorker()

    expect(run.results[0].outcome).toBe('retrying')
    const pubUpdates = updatesFor('social_publications').map((u) => u.args[0]) as Array<
      Record<string, unknown>
    >
    expect(pubUpdates.some((u) => u.status === 'queued')).toBe(true)
    const jobUpdates = updatesFor('shared_jobs').map((u) => u.args[0]) as Array<Record<string, unknown>>
    const retryUpdate = jobUpdates.find((u) => u.lifecycle_status === 'retrying')
    expect(retryUpdate).toBeDefined()
    expect(retryUpdate!.available_at).toBeDefined()
  })

  it('marks ambiguous failures as reconciling — never a blind retry', async () => {
    rpcMock.mockImplementation(async (fn: string) =>
      fn === 'claim_shared_jobs' ? { data: [JOB], error: null } : { data: null, error: null }
    )
    primeHappyTables()
    fakeAdapter.publish.mockRejectedValue(new AdapterError('timeout after send', 'ambiguous'))

    const run = await runWorker()

    expect(run.results[0].outcome).toBe('reconciling')
    const pubUpdates = updatesFor('social_publications').map((u) => u.args[0]) as Array<
      Record<string, unknown>
    >
    expect(pubUpdates.some((u) => u.status === 'reconciling')).toBe(true)
  })

  it('reconciles an ambiguous prior attempt without re-posting when the post exists', async () => {
    rpcMock.mockImplementation(async (fn: string) =>
      fn === 'claim_shared_jobs' ? { data: [JOB], error: null } : { data: null, error: null }
    )
    primeHappyTables({ publication: { status: 'reconciling' } })
    fakeAdapter.reconcile.mockResolvedValue({
      providerPostId: 'fb-existing',
      providerPostUrl: 'https://facebook.com/fb-existing',
    })

    const run = await runWorker()

    expect(run.results[0].outcome).toBe('reconciled')
    expect(fakeAdapter.publish).not.toHaveBeenCalled()
    const pubUpdates = updatesFor('social_publications').map((u) => u.args[0]) as Array<
      Record<string, unknown>
    >
    expect(
      pubUpdates.some((u) => u.status === 'published' && u.remote_post_id === 'fb-existing')
    ).toBe(true)
  })

  it('fails permanently on permanent errors', async () => {
    rpcMock.mockImplementation(async (fn: string) =>
      fn === 'claim_shared_jobs' ? { data: [JOB], error: null } : { data: null, error: null }
    )
    primeHappyTables()
    fakeAdapter.publish.mockRejectedValue(new AdapterError('invalid token', 'permanent'))

    const run = await runWorker()

    expect(run.results[0].outcome).toBe('failed')
    const pubUpdates = updatesFor('social_publications').map((u) => u.args[0]) as Array<
      Record<string, unknown>
    >
    expect(pubUpdates.some((u) => u.status === 'failed' && u.error_classification === 'permanent')).toBe(
      true
    )
    const jobUpdates = updatesFor('shared_jobs').map((u) => u.args[0]) as Array<Record<string, unknown>>
    expect(jobUpdates.some((u) => u.lifecycle_status === 'failed')).toBe(true)
  })

  it('fails after attempts are exhausted even for retryable errors', async () => {
    rpcMock.mockImplementation(async (fn: string) =>
      fn === 'claim_shared_jobs'
        ? { data: [{ ...JOB, attempt_count: 3 }], error: null }
        : { data: null, error: null }
    )
    primeHappyTables()
    fakeAdapter.publish.mockRejectedValue(new AdapterError('still rate limited', 'retryable'))

    const run = await runWorker()

    expect(run.results[0].outcome).toBe('failed')
    const jobUpdates = updatesFor('shared_jobs').map((u) => u.args[0]) as Array<Record<string, unknown>>
    expect(jobUpdates.some((u) => u.status_reason === 'attempts_exhausted')).toBe(true)
  })

  it('permanently fails jobs for disabled channels (launch gate)', async () => {
    channelEnabled = false
    rpcMock.mockImplementation(async (fn: string) =>
      fn === 'claim_shared_jobs' ? { data: [JOB], error: null } : { data: null, error: null }
    )
    primeHappyTables()

    const run = await runWorker()

    expect(run.results[0].outcome).toBe('failed')
    expect(run.results[0].error).toMatch(/not enabled/)
    expect(fakeAdapter.publish).not.toHaveBeenCalled()
  })

  it('skips cancelled publications and finishes their job', async () => {
    rpcMock.mockImplementation(async (fn: string) =>
      fn === 'claim_shared_jobs' ? { data: [JOB], error: null } : { data: null, error: null }
    )
    primeHappyTables({ publication: { status: 'cancelled' } })

    const run = await runWorker()

    expect(run.results[0].outcome).toBe('skipped')
    expect(fakeAdapter.publish).not.toHaveBeenCalled()
    const jobUpdates = updatesFor('shared_jobs').map((u) => u.args[0]) as Array<Record<string, unknown>>
    expect(jobUpdates.some((u) => u.lifecycle_status === 'cancelled')).toBe(true)
  })

  it('fails the job when the publication no longer exists', async () => {
    rpcMock.mockImplementation(async (fn: string) =>
      fn === 'claim_shared_jobs' ? { data: [JOB], error: null } : { data: null, error: null }
    )
    setResponses('social_publications', [{ data: null, error: null }])
    setResponses('shared_jobs', [{ data: null, error: null }])

    const run = await runWorker()

    expect(run.results[0].outcome).toBe('failed')
    expect(run.results[0].error).toMatch(/missing/)
  })

  it('uses an attempt-scoped idempotency key', async () => {
    rpcMock.mockImplementation(async (fn: string) =>
      fn === 'claim_shared_jobs'
        ? { data: [{ ...JOB, attempt_count: 2 }], error: null }
        : { data: null, error: null }
    )
    primeHappyTables()
    fakeAdapter.publish.mockResolvedValue({ providerPostId: 'fb-1', providerPostUrl: null })

    await runWorker()

    const attemptInsert = callLog.find(
      (entry) => entry.table === 'social_publication_attempts' && entry.method === 'insert'
    )
    expect(attemptInsert).toBeDefined()
    expect((attemptInsert!.args[0] as Record<string, unknown>).idempotency_key).toBe(
      'publication:pub-1:attempt:2'
    )
    expect(fakeAdapter.publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ idempotencyKey: 'publication:pub-1:attempt:2' })
    )
  })

  it('refreshes an expiring token, persists it encrypted, and publishes with the new token', async () => {
    rpcMock.mockImplementation(async (fn: string) =>
      fn === 'claim_shared_jobs' ? { data: [JOB], error: null } : { data: null, error: null }
    )
    primeHappyTables()
    // Expiring in 5 minutes with a refresh token available.
    setResponses('social_connections', [
      {
        data: {
          ...CONNECTION,
          refresh_token: 'enc:old-refresh',
          token_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        },
        error: null,
      },
    ])
    fakeAdapter.refreshToken.mockResolvedValue({
      accessToken: 'new-token',
      refreshToken: 'new-refresh',
      tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    })
    fakeAdapter.publish.mockResolvedValue({ providerPostId: 'fb-1', providerPostUrl: null })

    const run = await runWorker()

    expect(run.results[0].outcome).toBe('published')
    expect(fakeAdapter.refreshToken).toHaveBeenCalledTimes(1)
    // New tokens persisted encrypted.
    const connectionUpdates = updatesFor('social_connections').map((u) => u.args[0]) as Array<
      Record<string, unknown>
    >
    expect(
      connectionUpdates.some(
        (u) => u.access_token === 'enc:new-token' && u.refresh_token === 'enc:new-refresh'
      )
    ).toBe(true)
    // Publish used the refreshed token.
    const publishConnection = fakeAdapter.publish.mock.calls[0][0]
    expect(publishConnection.accessToken).toBe('new-token')
  })

  it('survives a crashing job and requeues it', async () => {
    rpcMock.mockImplementation(async (fn: string) =>
      fn === 'claim_shared_jobs' ? { data: [JOB], error: null } : { data: null, error: null }
    )
    // Publication query throws (simulated infra error surfaces as crash).
    setResponses('social_publications', [{ data: PUBLICATION, error: null }])
    setResponses('social_content_variants', [{ data: VARIANT, error: null }])
    setResponses('social_connections', [{ data: CONNECTION, error: null }])
    setResponses('shared_jobs', [{ data: null, error: null }])
    fakeAdapter.preflight.mockImplementation(() => {
      throw new TypeError('unexpected crash')
    })
    setResponses('social_publication_attempts', [{ data: { id: 'attempt-1' }, error: null }])

    const run = await runWorker()

    // TypeError message is not network-like → classified permanent → failed.
    expect(run.results[0].outcome).toBe('failed')
  })
})
