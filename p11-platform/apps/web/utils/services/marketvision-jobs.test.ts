import { beforeEach, describe, expect, it, vi } from 'vitest'

const runSharedExecutorJobMock = vi.fn()
const createServiceClientMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/shared-executor', () => ({
  runSharedExecutorJob: runSharedExecutorJobMock,
}))

type QueryResult = { data: unknown }

function mockSupabase({
  activeRuns = [],
  dedupeRow = { id: 'shared-job-1' },
}: {
  activeRuns?: Array<{ id: string; lifecycle_status: string; updated_at: string }>
  dedupeRow?: { id: string } | null
} = {}) {
  const updateEqMock = vi.fn().mockResolvedValue({ error: null })
  const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock })

  // Chainable query builder that resolves to the configured result.
  const makeBuilder = (result: QueryResult) => {
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    for (const method of ['select', 'eq', 'in', 'gte', 'order']) {
      builder[method] = vi.fn(chain)
    }
    builder.limit = vi.fn().mockResolvedValue(result)
    builder.maybeSingle = vi.fn().mockResolvedValue(result)
    return builder
  }

  let callCount = 0
  const fromMock = vi.fn(() => {
    callCount += 1
    // First query: active-run check. Later queries: dedupe-key lookup.
    if (callCount === 1) {
      return makeBuilder({ data: activeRuns })
    }
    const builder = makeBuilder({ data: dedupeRow })
    builder.update = updateMock
    return builder
  })

  createServiceClientMock.mockReturnValue({ from: fromMock })
  return { fromMock, updateMock, updateEqMock }
}

describe('runMarketVisionIngestionJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('runs the work under the shared executor and reports success', async () => {
    mockSupabase()
    runSharedExecutorJobMock.mockImplementation(async (input) => input.execute())

    const { runMarketVisionIngestionJob } = await import('./marketvision-jobs')
    const result = await runMarketVisionIngestionJob({
      orgId: 'org-1',
      propertyId: 'property-1',
      runType: 'observation_refresh',
      execute: async () => ({ total: 3, succeeded: 3, failed: 0, data: { ok: true } }),
    })

    expect(result.result).toBe('succeeded')
    expect(result.outcome.succeeded).toBe(3)
    expect(runSharedExecutorJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        propertyId: 'property-1',
        domain: 'marketvision.ingestion',
        subjectType: 'observation_refresh',
      }),
    )
  })

  it('marks mixed runs as partial (not generic success)', async () => {
    const { updateMock } = mockSupabase()
    runSharedExecutorJobMock.mockImplementation(async (input) => input.execute())

    const { runMarketVisionIngestionJob } = await import('./marketvision-jobs')
    const result = await runMarketVisionIngestionJob({
      orgId: 'org-1',
      propertyId: 'property-1',
      runType: 'observation_refresh',
      execute: async () => ({ total: 3, succeeded: 2, failed: 1, data: {} }),
    })

    expect(result.result).toBe('partial')
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status_reason: 'completed_partial' }),
    )
  })

  it('fails the run when every source failed', async () => {
    mockSupabase()
    runSharedExecutorJobMock.mockImplementation(async (input) => input.execute())

    const { runMarketVisionIngestionJob, MarketVisionRunFailedError } = await import(
      './marketvision-jobs'
    )

    await expect(
      runMarketVisionIngestionJob({
        orgId: 'org-1',
        propertyId: 'property-1',
        runType: 'observation_refresh',
        execute: async () => ({ total: 2, succeeded: 0, failed: 2, data: {} }),
      }),
    ).rejects.toBeInstanceOf(MarketVisionRunFailedError)
  })

  it('rejects when an equivalent run is already active', async () => {
    mockSupabase({
      activeRuns: [
        { id: 'active-job', lifecycle_status: 'running', updated_at: new Date().toISOString() },
      ],
    })

    const { runMarketVisionIngestionJob, MarketVisionActiveRunError } = await import(
      './marketvision-jobs'
    )

    await expect(
      runMarketVisionIngestionJob({
        orgId: 'org-1',
        propertyId: 'property-1',
        runType: 'discovery',
        execute: async () => ({ total: 0, succeeded: 0, failed: 0, data: {} }),
      }),
    ).rejects.toBeInstanceOf(MarketVisionActiveRunError)
    expect(runSharedExecutorJobMock).not.toHaveBeenCalled()
  })
})
