import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { z } from 'zod'

const { resolveMock, ingestMock, rateCheckMock } = vi.hoisted(() => ({
  resolveMock: vi.fn(),
  ingestMock: vi.fn(),
  rateCheckMock: vi.fn(),
}))

vi.mock('@/utils/siteforge/providers/conversions', () => ({
  resolvePublicWebsiteConversionContext: resolveMock,
  ingestPublicSiteForgeConversion: ingestMock,
  isAllowedPublicWebsiteOrigin: (
    context: { allowedOrigins: string[] },
    origin: string | null
  ) => Boolean(origin && context.allowedOrigins.includes(origin)),
}))
vi.mock('@/utils/services/rate-limiter', () => ({
  leadLimiter: { check: rateCheckMock },
  getRateLimitKey: vi.fn(() => 'siteforge-conversion:test'),
  rateLimitHeaders: vi.fn(() => ({ 'Retry-After': '60' })),
}))

const websiteId = '11111111-1111-4111-8111-111111111111'
const routeContext = { params: Promise.resolve({ websiteId }) }

function request(
  body: unknown,
  origin = 'https://property.example.com',
  publicKey = 'sf_public_test'
) {
  return new Request(
    `http://localhost/api/siteforge/public/conversions/${websiteId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'X-SiteForge-Key': publicKey,
      },
      body: JSON.stringify(body),
    }
  ) as NextRequest
}

describe('SiteForge public conversion ingress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveMock.mockResolvedValue({
      websiteId,
      publicKey: 'sf_public_test',
      artifactId: '55555555-5555-4555-8555-555555555555',
      propertyId: '22222222-2222-4222-8222-222222222222',
      orgId: '33333333-3333-4333-8333-333333333333',
      propertyName: 'Aspen House',
      provider: 'lumaleasing',
      toursEnabled: true,
      allowedOrigins: ['https://property.example.com'],
    })
    ingestMock.mockResolvedValue({
      leadId: '44444444-4444-4444-8444-444444444444',
      duplicate: false,
    })
    rateCheckMock.mockReturnValue({
      allowed: true,
      remaining: 14,
      resetAt: Date.now() + 60_000,
    })
  })

  it('accepts the WordPress form payload without client tenant identifiers', async () => {
    const payload = {
      name: 'Jordan Lee',
      email: 'jordan@example.com',
      phone: '555-555-0100',
      form_type: 'contact',
      submission_id: 'siteforge-form-123',
      consent: true,
      consent_text: 'I agree to receive leasing communications.',
      timestamp: '2026-07-31T12:00:00.000Z',
      page_url: 'https://property.example.com/contact/',
      message: 'Interested in a one-bedroom home.',
    }
    const { POST } = await import('./route')
    const response = await POST(request(payload), routeContext)

    expect(response.status).toBe(201)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://property.example.com'
    )
    expect(ingestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: '33333333-3333-4333-8333-333333333333',
        propertyId: '22222222-2222-4222-8222-222222222222',
        artifactId: '55555555-5555-4555-8555-555555555555',
      }),
      payload
    )
    expect(payload).not.toHaveProperty('orgId')
    expect(payload).not.toHaveProperty('propertyId')
  })

  it('rejects an origin not certified for the generated website', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      request({}, 'https://attacker.example.com'),
      routeContext
    )

    expect(response.status).toBe(403)
    expect(ingestMock).not.toHaveBeenCalled()
  })

  it('rejects a request without the certified publishable key', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      request(
        {
          email: 'jordan@example.com',
          submission_id: 'siteforge-form-123',
          consent: true,
          consent_text: 'I agree to receive leasing communications.',
        },
        'https://property.example.com',
        ''
      ),
      routeContext
    )

    expect(response.status).toBe(401)
    expect(ingestMock).not.toHaveBeenCalled()
  })

  it('rejects a page URL whose origin differs from the request', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      request({ page_url: 'https://other.example.com/contact' }),
      routeContext
    )

    expect(response.status).toBe(403)
    expect(ingestMock).not.toHaveBeenCalled()
  })

  it('rate limits repeated submissions before side effects run', async () => {
    rateCheckMock.mockReturnValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      retryAfterMs: 60_000,
    })
    const { POST } = await import('./route')
    const response = await POST(request({}), routeContext)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(ingestMock).not.toHaveBeenCalled()
  })

  it('returns validation failure when conversion consent evidence is absent', async () => {
    ingestMock.mockRejectedValueOnce(
      new z.ZodError([
        {
          code: 'custom',
          path: ['consent'],
          message: 'Consent is required',
        },
      ])
    )
    const { POST } = await import('./route')
    const response = await POST(
      request({
        email: 'jordan@example.com',
        submission_id: 'siteforge-form-123',
        page_url: 'https://property.example.com/contact/',
      }),
      routeContext
    )

    expect(response.status).toBe(400)
  })
})
