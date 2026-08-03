import { describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { authorizeMock, upsertMock } = vi.hoisted(() => ({
  authorizeMock: vi.fn(),
  upsertMock: vi.fn(),
}))

vi.mock('@/utils/siteforge/operations-auth', () => ({
  authorizeSiteForgeWebsite: authorizeMock,
}))
vi.mock('@/utils/siteforge/operations/analytics', () => ({
  upsertValidatedAnalyticsDestination: upsertMock,
}))

const websiteId = '11111111-1111-4111-8111-111111111111'

describe('SiteForge analytics destinations route', () => {
  it('requires an exact website identity', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/siteforge/analytics/destinations') as NextRequest
    )
    expect(response.status).toBe(400)
    expect(authorizeMock).not.toHaveBeenCalled()
  })

  it('requires manager authorization before saving a destination', async () => {
    authorizeMock.mockResolvedValue({ error: 'Manager access required', status: 403 })
    const { PUT } = await import('./route')
    const response = await PUT(
      new Request('http://localhost/api/siteforge/analytics/destinations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteId,
          destination: {
            destinationType: 'ga4',
            destinationIdentity: 'G-ABCDEF12',
            configuration: { apiSecret: 'secret-value' },
            consentMode: 'required',
            enabled: true,
          },
        }),
      }) as NextRequest
    )
    expect(response.status).toBe(403)
    expect(authorizeMock).toHaveBeenCalledWith(websiteId, true)
    expect(upsertMock).not.toHaveBeenCalled()
  })
})
