import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mockFrom = vi.fn()
const startCronJobRunMock = vi.fn()
const finishCronJobRunMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}))

vi.mock('@/utils/services/cron-job-runs', () => ({
  startCronJobRun: startCronJobRunMock,
  finishCronJobRun: finishCronJobRunMock,
}))

vi.stubGlobal('fetch', vi.fn())

/** Mock for the due-drafts fetch: select → lte → or → order → limit */
function buildFetchChain(result: { data: unknown; error: unknown }) {
  return vi.fn(() => ({
    lte: vi.fn(() => ({
      or: vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(result),
        })),
      })),
    })),
  }))
}

/**
 * Mock for the atomic claim: update({status:'publishing'}) → eq → lte → eq →
 * select → maybeSingle. The chain object returns itself for filter calls.
 */
function buildClaimChain(maybeSingleMock: ReturnType<typeof vi.fn>) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  chain.eq = vi.fn(() => chain)
  chain.lte = vi.fn(() => chain)
  chain.lt = vi.fn(() => chain)
  chain.select = vi.fn(() => ({ maybeSingle: maybeSingleMock }))
  return chain
}

describe('GET /api/cron/publish-scheduled', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    startCronJobRunMock.mockResolvedValue({
      id: 'run-1',
      jobName: 'publish-scheduled',
      startedAtMs: 0,
    })
    finishCronJobRunMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns 401 when CRON_SECRET is set and Bearer token is wrong', async () => {
    process.env.CRON_SECRET = 'expected-secret'

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/publish-scheduled', {
      method: 'GET',
      headers: { authorization: 'Bearer wrong-secret' },
    }) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('returns success with processed 0 when no scheduled posts', async () => {
    process.env.CRON_SECRET = 'expected-secret'

    mockFrom.mockReturnValue({
      select: buildFetchChain({ data: [], error: null }),
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/publish-scheduled', {
      method: 'GET',
      headers: { authorization: 'Bearer expected-secret' },
    }) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      success: true,
      message: 'No posts to publish',
      processed: 0,
    })
  })

  it('skips drafts already claimed by another worker', async () => {
    process.env.CRON_SECRET = 'expected-secret'

    const claimMaybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null })
    const claimChain = buildClaimChain(claimMaybeSingleMock)

    mockFrom.mockImplementation((table: string) => {
      if (table === 'content_drafts') {
        return {
          select: buildFetchChain({
            data: [
              {
                id: 'draft-1',
                status: 'scheduled',
                property_id: 'property-1',
                platform: 'facebook',
              },
            ],
            error: null,
          }),
          update: vi.fn(() => claimChain),
        }
      }
      if (table === 'social_connections') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
            })),
          })),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/publish-scheduled', {
      method: 'GET',
      headers: { authorization: 'Bearer expected-secret' },
    }) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      success: true,
      processed: 1,
      published: 0,
      failed: 0,
      retrying: 0,
      skipped: 1,
      results: [
        {
          draftId: 'draft-1',
          status: 'skipped',
        },
      ],
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns 500 when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/publish-scheduled', {
      method: 'GET',
    }) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'CRON_SECRET is required for publish-scheduled cron execution',
    })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('releases the claim for retry when the publish route reports only retryable failures', async () => {
    process.env.CRON_SECRET = 'expected-secret'

    const draftUpdateEqMock = vi.fn().mockResolvedValue({ error: null })
    const claimMaybeSingleMock = vi.fn().mockResolvedValue({ data: { id: 'draft-1' }, error: null })
    const claimChain = buildClaimChain(claimMaybeSingleMock)
    const releaseUpdatePayloads: Array<Record<string, unknown>> = []

    mockFrom.mockImplementation((table: string) => {
      if (table === 'content_drafts') {
        return {
          select: buildFetchChain({
            data: [
              {
                id: 'draft-1',
                status: 'scheduled',
                property_id: 'property-1',
                platform: 'facebook',
              },
            ],
            error: null,
          }),
          update: vi.fn((payload: Record<string, unknown>) => {
            if (payload.status === 'publishing') {
              return claimChain
            }
            releaseUpdatePayloads.push(payload)
            return {
              eq: draftUpdateEqMock,
            }
          }),
        }
      }

      if (table === 'social_connections') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({
                  data: [{ id: 'conn-1', platform: 'facebook' }],
                  error: null,
                }),
              })),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table ${table}`)
    })

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: false,
        retryableFailureCount: 1,
        permanentFailureCount: 0,
        results: [
          {
            connectionId: 'conn-1',
            platform: 'facebook',
            success: false,
            retryable: true,
            error: 'Temporary provider outage',
          },
        ],
      }),
    } as unknown as Response)

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/publish-scheduled', {
      method: 'GET',
      headers: { authorization: 'Bearer expected-secret' },
    }) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      success: true,
      processed: 1,
      published: 0,
      failed: 0,
      retrying: 1,
      results: [
        {
          draftId: 'draft-1',
          status: 'retrying',
          error: 'Temporary provider outage',
        },
      ],
    })
    expect(draftUpdateEqMock).toHaveBeenCalledWith('id', 'draft-1')
    // The retryable path must release the claim back to `scheduled`.
    expect(releaseUpdatePayloads[0]).toMatchObject({ status: 'scheduled' })
  })
})
