import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createServiceClientMock = vi.fn()
const startCronJobRunMock = vi.fn()
const finishCronJobRunMock = vi.fn()
const syncGoogleAdsConnectionMock = vi.fn()
const syncMetaAdsConnectionMock = vi.fn()
const runSharedExecutorJobMock = vi.fn()
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/utils/services/cron-job-runs', () => ({
  startCronJobRun: startCronJobRunMock,
  finishCronJobRun: finishCronJobRunMock,
}))

vi.mock('@/app/api/integrations/google-ads/sync/route', () => ({
  syncGoogleAdsConnection: syncGoogleAdsConnectionMock,
}))
vi.mock('@/app/api/integrations/meta-ads/sync/route', () => ({
  syncMetaAdsConnection: syncMetaAdsConnectionMock,
}))
vi.mock('@/utils/services/shared-executor', () => ({
  runSharedExecutorJob: runSharedExecutorJobMock,
}))

describe('GET /api/cron/sync-ads', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    startCronJobRunMock.mockResolvedValue({
      id: 'run-1',
      jobName: 'sync-ads',
      startedAtMs: 0,
    })
    finishCronJobRunMock.mockResolvedValue(undefined)
    runSharedExecutorJobMock.mockImplementation(async ({ execute }: { execute: () => Promise<unknown> }) =>
      execute()
    )
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns 401 when CRON_SECRET is set and Bearer token is wrong', async () => {
    process.env.CRON_SECRET = 'expected-secret'

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/sync-ads', {
      method: 'GET',
      headers: { authorization: 'Bearer wrong-secret' },
    }) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('returns success with synced 0 when no active connections', async () => {
    process.env.CRON_SECRET = 'expected-secret'

    createServiceClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/sync-ads', {
      method: 'GET',
      headers: { authorization: 'Bearer expected-secret' },
    }) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      message: 'No connections to sync',
      synced: 0,
    })
  })

  it('retries retryable connection failures and summarizes permanent failures separately', async () => {
    process.env.CRON_SECRET = 'expected-secret'

    createServiceClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: [
              { id: 'google-1', property_id: 'property-1', org_id: 'org-1', platform: 'google_ads', account_id: '123' },
              { id: 'meta-1', property_id: 'property-1', org_id: 'org-1', platform: 'meta_ads', account_id: '456' },
            ],
            error: null,
          }),
        })),
      })),
    })

    syncGoogleAdsConnectionMock
      .mockResolvedValueOnce({ synced: 0, error: 'temporary outage', retryable: true })
      .mockResolvedValueOnce({ synced: 7 })
    syncMetaAdsConnectionMock.mockResolvedValue({
      synced: 0,
      error: 'bad credentials',
      retryable: false,
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/sync-ads', {
      method: 'GET',
      headers: { authorization: 'Bearer expected-secret' },
    }) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      success: true,
      totalConnections: 2,
      totalSynced: 7,
      failures: 1,
      retryableFailures: 0,
      permanentFailures: 1,
    })
    expect(syncGoogleAdsConnectionMock).toHaveBeenCalledTimes(2)
    expect(syncMetaAdsConnectionMock).toHaveBeenCalledTimes(1)
    expect(runSharedExecutorJobMock).toHaveBeenCalledTimes(2)
    expect(runSharedExecutorJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'cron.sync-ads',
        subjectType: 'ad_account_connection',
        action: expect.objectContaining({
          actionType: 'sync_ad_account',
          proposalDecisionStatus: 'approved',
        }),
      })
    )
  })
})
