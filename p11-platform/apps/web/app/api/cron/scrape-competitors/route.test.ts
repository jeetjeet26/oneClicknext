import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createServiceClientMock = vi.fn()
const startCronJobRunMock = vi.fn()
const finishCronJobRunMock = vi.fn()
const fetchMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/cron-job-runs', () => ({
  startCronJobRun: startCronJobRunMock,
  finishCronJobRun: finishCronJobRunMock,
}))

vi.stubGlobal('fetch', fetchMock)

describe('GET /api/cron/scrape-competitors', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    startCronJobRunMock.mockResolvedValue({
      id: 'run-1',
      jobName: 'scrape-competitors',
      startedAtMs: 0,
    })
    finishCronJobRunMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('returns 401 when cron auth is invalid', async () => {
    process.env.CRON_SECRET = 'expected-secret'

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/scrape-competitors', {
      method: 'GET',
      headers: {
        authorization: 'Bearer wrong-secret',
      },
    }) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('returns success when no properties are configured for scraping', async () => {
    process.env.CRON_SECRET = 'expected-secret'
    createServiceClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        })),
      })),
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/scrape-competitors', {
      method: 'GET',
      headers: {
        authorization: 'Bearer expected-secret',
      },
    }) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: 'No properties configured for scraping',
      processed: 0,
    })
  })

  it('returns 503 when the data engine is unavailable', async () => {
    process.env.CRON_SECRET = 'expected-secret'
    createServiceClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: [
              {
                property_id: 'property-1',
                scrape_frequency: 'daily',
                last_run_at: null,
                error_count: 0,
              },
            ],
            error: null,
          }),
        })),
      })),
    })
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8000'))

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/scrape-competitors', {
      method: 'GET',
      headers: {
        authorization: 'Bearer expected-secret',
      },
    }) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(503)
    expect(json).toEqual({
      success: false,
      message: 'Data engine service unavailable',
      error: 'Could not connect to scraping service',
      total: 1,
      scheduled: 1,
    })
    expect(finishCronJobRunMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'failed',
        error: 'Could not connect to scraping service',
      })
    )
  })
})
