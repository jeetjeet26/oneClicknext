import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { exchangeMock } = vi.hoisted(() => ({
  exchangeMock: vi.fn(),
}))

vi.mock('@/utils/siteforge/review/access', () => ({
  exchangeReviewToken: exchangeMock,
}))

const rawToken = 'sfr_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

describe('SiteForge review token exchange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    exchangeMock.mockResolvedValue({
      credential: {},
      sessionCookie: 'signed-session-cookie',
    })
  })

  it('sets a secure HttpOnly cookie and redirects to a tokenless URL', async () => {
    const { GET } = await import('./route')
    const request = new Request(
      `https://app.example.com/siteforge-review/${rawToken}`,
      { headers: { 'x-forwarded-for': '203.0.113.4' } }
    ) as NextRequest
    const response = await GET(request, {
      params: Promise.resolve({ token: rawToken }),
    })
    const serialized = `${response.headers.get('location')} ${response.headers.get('set-cookie')}`

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      'https://app.example.com/siteforge-review'
    )
    expect(response.headers.get('set-cookie')).toContain(
      '__Host-siteforge_review=signed-session-cookie'
    )
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('set-cookie')).toContain('Secure')
    expect(response.headers.get('set-cookie')?.toLowerCase()).toContain(
      'samesite=lax'
    )
    expect(response.headers.get('set-cookie')).toContain('Path=/')
    expect(serialized).not.toContain(rawToken)
    expect(exchangeMock).toHaveBeenCalledWith(
      rawToken,
      'siteforge-client-review:203.0.113.4'
    )
  })
})
