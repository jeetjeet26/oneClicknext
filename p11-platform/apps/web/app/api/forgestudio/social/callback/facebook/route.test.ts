import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(),
  })),
}))

vi.mock('@/utils/forgestudio/social-config', () => ({
  getMetaCredentials: vi.fn(),
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
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('redirects with invalid_state when signed state is invalid', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new Request(
        'http://localhost/api/forgestudio/social/callback/facebook?code=abc&state=invalid-state'
      ) as NextRequest
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=invalid_state')
  })
})
