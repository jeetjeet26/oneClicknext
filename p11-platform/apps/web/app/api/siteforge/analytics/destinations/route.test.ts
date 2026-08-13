import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  beforeEach(() => {
    vi.clearAllMocks()
    authorizeMock.mockResolvedValue({
      website: {
        org_id: '22222222-2222-4222-8222-222222222222',
        property_id: '33333333-3333-4333-8333-333333333333',
      },
      service: {},
    })
    upsertMock.mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
      destination_type: 'ga4',
      destination_identity: 'G-ABCDEF12',
      consent_mode: 'required',
      enabled: true,
    })
  })

  it('persists validated GA4 identity and explicit consent configuration', async () => {
    const { PUT } = await import('./route')
    const destination = {
      destinationType: 'ga4',
      destinationIdentity: 'G-ABCDEF12',
      configuration: { apiSecret: 'secret-123' },
      consentMode: 'required',
      enabled: true,
    }
    const response = await PUT(
      new Request('http://localhost/api/siteforge/analytics/destinations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteId, destination }),
      }) as NextRequest
    )

    expect(response.status).toBe(201)
    expect(authorizeMock).toHaveBeenCalledWith(websiteId, true)
    expect(upsertMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ websiteId }),
      destination
    )
  })

  it('does not report readiness for an invalid destination identity', async () => {
    upsertMock.mockRejectedValueOnce(new Error('Invalid analytics destination'))
    const { PUT } = await import('./route')
    const response = await PUT(
      new Request('http://localhost/api/siteforge/analytics/destinations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteId,
          destination: {
            destinationType: 'gtm',
            destinationIdentity: 'not-a-container',
            configuration: { dataLayerName: 'dataLayer' },
            consentMode: 'required',
            enabled: true,
          },
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(422)
  })

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
