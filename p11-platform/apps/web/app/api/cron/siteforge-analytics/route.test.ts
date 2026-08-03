import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { persistMock, limitMock, fromMock } = vi.hoisted(() => {
  const limit = vi.fn()
  const not = vi.fn(() => ({ not, limit }))
  const select = vi.fn(() => ({ not }))
  const from = vi.fn(() => ({ select }))
  return {
    persistMock: vi.fn(),
    limitMock: limit,
    fromMock: from,
  }
})

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => ({ from: fromMock }),
}))
vi.mock('@/utils/siteforge/operations/analytics', () => ({
  persistArtifactFunnelsAndIncidents: persistMock,
}))

describe('GET /api/cron/siteforge-analytics', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv, CRON_SECRET: 'expected-secret' }
    limitMock.mockResolvedValue({
      data: [{ id: 'website-1', org_id: 'org-1', property_id: 'property-1' }],
      error: null,
    })
    persistMock.mockResolvedValue({ artifacts: 1, proposals: 0 })
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('rejects an invalid cron secret', async () => {
    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost/api/cron/siteforge-analytics', {
      headers: { authorization: 'Bearer wrong-secret' },
    }) as NextRequest)

    expect(response.status).toBe(401)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('persists artifact-aware funnels and anomaly proposals', async () => {
    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost/api/cron/siteforge-analytics', {
      headers: { authorization: 'Bearer expected-secret' },
    }) as NextRequest)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      websites: 1,
      artifacts: 1,
      proposals: 0,
    })
    expect(persistMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: fromMock }),
      expect.objectContaining({
        websiteId: 'website-1',
        orgId: 'org-1',
        propertyId: 'property-1',
      })
    )
  })
})
