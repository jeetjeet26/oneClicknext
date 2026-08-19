import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { syncMock } = vi.hoisted(() => ({ syncMock: vi.fn() }))

vi.mock('@/utils/forgestudio/engagement-sync', () => ({
  syncRecentPublicationMetrics: syncMock,
}))

describe('GET /api/cron/sync-forgestudio-metrics', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv, CRON_SECRET: 'expected-secret' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('rejects invalid cron authentication', async () => {
    const { GET } = await import('./route')
    const response = await GET(new Request(
      'http://localhost/api/cron/sync-forgestudio-metrics',
      { headers: { authorization: 'Bearer wrong-secret' } }
    ) as NextRequest)
    expect(response.status).toBe(401)
    expect(syncMock).not.toHaveBeenCalled()
  })

  it('syncs aggregate metrics with request tracing', async () => {
    syncMock.mockResolvedValue({ synced: 2, unsupported: 1, failed: 0 })
    const { GET } = await import('./route')
    const response = await GET(new Request(
      'http://localhost/api/cron/sync-forgestudio-metrics',
      { headers: { authorization: 'Bearer expected-secret' } }
    ) as NextRequest)
    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toMatchObject({ synced: 2, failed: 0 })
  })
})
