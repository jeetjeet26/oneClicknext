import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { authorizeMock, getReviewMock, safeErrorMock } = vi.hoisted(() => ({
  authorizeMock: vi.fn(),
  getReviewMock: vi.fn(),
  safeErrorMock: vi.fn(),
}))

vi.mock('@/utils/siteforge/review/access', () => ({
  authorizeReviewSession: authorizeMock,
}))

vi.mock('@/utils/siteforge/review/service', () => ({
  getPublicReviewData: getReviewMock,
}))

vi.mock('@/utils/siteforge/review/http', () => ({
  safeReviewError: safeErrorMock,
}))

function request(cookie = '__Host-siteforge_review=incoming-session') {
  return new Request('http://localhost/api/siteforge/reviews/public', {
    headers: cookie
      ? { cookie, 'x-forwarded-for': '203.0.113.7' }
      : { 'x-forwarded-for': '203.0.113.7' },
  }) as NextRequest
}

describe('public SiteForge review route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authorizeMock.mockResolvedValue({
      credential: { token: { id: 'token-1' } },
      sessionCookie: 'refreshed-session',
    })
    getReviewMock.mockResolvedValue({
      session: { id: 'session-1', title: 'Client review' },
      artifact: {
        id: '55555555-5555-4555-8555-555555555555',
        version: 3,
        isCurrent: true,
      },
      permissions: ['view'],
      preview: { pages: [] },
      rounds: [],
      comments: [],
      decisions: [],
      clientApproval: null,
    })
    safeErrorMock.mockImplementation(error => ({
      status: error?.statusCode || 500,
      code: error?.code || 'review_error',
      message: error?.message || 'Review request could not be completed',
    }))
  })

  it('uses the shared session boundary and returns no token serialization', async () => {
    const { GET } = await import('./route')
    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(response.headers.get('set-cookie')).toContain(
      '__Host-siteforge_review=refreshed-session'
    )
    expect(authorizeMock).toHaveBeenCalledWith(
      'incoming-session',
      'view',
      'siteforge-client-review:203.0.113.7'
    )
    expect(getReviewMock).toHaveBeenCalledWith(
      expect.objectContaining({ token: { id: 'token-1' } })
    )
    expect(JSON.stringify(body)).not.toContain('sfr_')
  })

  it('rejects a missing session before loading review data', async () => {
    authorizeMock.mockRejectedValueOnce(
      Object.assign(new Error('Review session is missing'), {
        statusCode: 401,
        code: 'invalid_session',
      })
    )
    const { GET } = await import('./route')
    const response = await GET(request(''))

    expect(response.status).toBe(401)
    expect(getReviewMock).not.toHaveBeenCalled()
  })

  it('returns shared boundary rate-limit failures before review data access', async () => {
    authorizeMock.mockRejectedValueOnce(
      Object.assign(new Error('Too many review requests'), {
        statusCode: 429,
        code: 'rate_limited',
      })
    )
    const { GET } = await import('./route')
    const response = await GET(request())

    expect(response.status).toBe(429)
    expect(getReviewMock).not.toHaveBeenCalled()
  })
})
