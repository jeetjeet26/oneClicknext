import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { resolveMock, upsertMock, rateCheckMock, persistTouchesMock } = vi.hoisted(() => ({
  resolveMock: vi.fn(),
  upsertMock: vi.fn(),
  rateCheckMock: vi.fn(),
  persistTouchesMock: vi.fn(),
}))

vi.mock('@/utils/siteforge/providers/conversions', () => ({
  resolvePublicWebsiteConversionContext: resolveMock,
  isAllowedPublicWebsiteOrigin: (
    context: { allowedOrigins: string[] },
    origin: string | null
  ) => Boolean(origin && context.allowedOrigins.includes(origin)),
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => ({
    from: vi.fn(() => ({ upsert: upsertMock })),
  }),
}))
vi.mock('@/utils/siteforge/operations/attribution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/siteforge/operations/attribution')>()),
  persistAttributionTouches: persistTouchesMock,
}))
vi.mock('@/utils/services/rate-limiter', () => ({
  publicReadLimiter: { check: rateCheckMock },
  getRateLimitKey: vi.fn(() => 'siteforge-telemetry:test'),
  rateLimitHeaders: vi.fn(() => ({ 'Retry-After': '60' })),
}))

const websiteId = '11111111-1111-4111-8111-111111111111'
const routeContext = { params: Promise.resolve({ websiteId }) }

function request(body: unknown, publicKey = 'sf_public_test') {
  return new Request(
    `http://localhost/api/siteforge/public/telemetry/${websiteId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://property.example.com',
        'X-SiteForge-Key': publicKey,
      },
      body: JSON.stringify(body),
    }
  ) as NextRequest
}

describe('SiteForge first-party telemetry ingress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveMock.mockResolvedValue({
      websiteId,
      propertyId: '22222222-2222-4222-8222-222222222222',
      orgId: '33333333-3333-4333-8333-333333333333',
      publicKey: 'sf_public_test',
      artifactId: '44444444-4444-4444-8444-444444444444',
      allowedOrigins: ['https://property.example.com'],
    })
    rateCheckMock.mockReturnValue({
      allowed: true,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    })
    upsertMock.mockResolvedValue({ error: null })
    persistTouchesMock.mockResolvedValue(undefined)
  })

  it('stores a consented event against server-owned website identity', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      request({
        eventType: 'lead_submit',
        idempotencyKey: 'telemetry-12345678',
        sessionId: 'session-12345678',
        consentState: 'granted',
        pageUrl: 'https://property.example.com/floor-plans/',
        campaign: { source: 'google', medium: 'cpc' },
      }),
      routeContext
    )

    expect(response.status).toBe(202)
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        website_id: websiteId,
        artifact_id: '44444444-4444-4444-8444-444444444444',
        event_type: 'lead_submit',
        page_path: '/floor-plans/',
        consent_state: 'granted',
      }),
      expect.objectContaining({
        onConflict: 'website_id,idempotency_key',
        ignoreDuplicates: true,
      })
    )
  })

  it('rejects unconsented analytics before storage', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      request({
        eventType: 'page_view',
        idempotencyKey: 'telemetry-12345678',
        sessionId: 'session-12345678',
        consentState: 'denied',
        pageUrl: 'https://property.example.com/',
      }),
      routeContext
    )

    expect(response.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('rejects a forged publishable key', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      request(
        {
          eventType: 'page_view',
          idempotencyKey: 'telemetry-12345678',
          sessionId: 'session-12345678',
          consentState: 'granted',
          pageUrl: 'https://property.example.com/',
        },
        'forged'
      ),
      routeContext
    )

    expect(response.status).toBe(401)
    expect(upsertMock).not.toHaveBeenCalled()
  })
})
