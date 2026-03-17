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

describe('GET /api/cron/sync-reviews', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    startCronJobRunMock.mockResolvedValue({
      id: 'run-1',
      jobName: 'sync-reviews',
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
    const request = new Request('http://localhost/api/cron/sync-reviews', {
      method: 'GET',
      headers: { authorization: 'Bearer wrong-secret' },
    }) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('returns success with synced 0 when no connections to sync', async () => {
    process.env.CRON_SECRET = 'expected-secret'

    mockFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(() => ({
            or: vi.fn(() => ({
              lt: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                })),
              })),
            })),
          })),
        })),
      })),
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/sync-reviews', {
      method: 'GET',
      headers: { authorization: 'Bearer expected-secret' },
    }) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      success: true,
      message: 'No connections to sync',
      synced: 0,
    })
  })

  it('skips connections that are already claimed by another worker', async () => {
    process.env.CRON_SECRET = 'expected-secret'

    const claimMaybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null })
    const claimSelectMock = vi.fn(() => ({ maybeSingle: claimMaybeSingleMock }))
    const claimOrMock = vi.fn(() => ({ select: claimSelectMock }))
    const claimInMock = vi.fn(() => ({ or: claimOrMock }))
    const claimEqActiveMock = vi.fn(() => ({ in: claimInMock }))
    const claimEqIdMock = vi.fn(() => ({ eq: claimEqActiveMock }))
    const claimUpdateMock = vi.fn(() => ({ eq: claimEqIdMock }))

    mockFrom.mockImplementation((table: string) => {
      if (table === 'review_platform_connections') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(() => ({
                or: vi.fn(() => ({
                  lt: vi.fn(() => ({
                    order: vi.fn(() => ({
                      limit: vi.fn().mockResolvedValue({
                        data: [
                          {
                            id: 'conn-1',
                            property_id: 'property-1',
                            platform: 'google',
                          },
                        ],
                        error: null,
                      }),
                    })),
                  })),
                })),
              })),
            })),
          })),
          update: claimUpdateMock,
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/sync-reviews', {
      method: 'GET',
      headers: { authorization: 'Bearer expected-secret' },
    }) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      success: true,
      synced: 0,
      failed: 0,
      skipped: 1,
      totalImported: 0,
      results: [
        {
          connectionId: 'conn-1',
          status: 'skipped',
        },
      ],
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns 500 when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/sync-reviews', {
      method: 'GET',
    }) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'CRON_SECRET is required for sync-reviews cron execution',
    })
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
