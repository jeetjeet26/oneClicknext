import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createServerClientMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createServerClientMock,
}))

vi.mock('@/utils/forgestudio/social-config', () => ({
  getMetaCredentials: vi.fn(),
  getLinkedInCredentials: vi.fn(),
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(),
  })),
}))

describe('forgestudio social callback facebook route', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
      SUPABASE_SERVICE_ROLE_KEY: 'test-secret',
    }
    createServerClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('redirects with unauthorized error when the session is missing', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest(
        'http://localhost/api/forgestudio/social/callback/facebook?code=abc&state=some-state'
      )
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=Unauthorized')
  })

  it('redirects with invalid_state when signed state is invalid', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest(
        'http://localhost/api/forgestudio/social/callback/facebook?code=abc&state=invalid-state'
      )
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=invalid_state')
  })
})
