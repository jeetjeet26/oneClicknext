import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/utils/services/google-calendar', () => ({
  getCalendarConfig: vi.fn(),
  ensureCalendarWatch: vi.fn(),
}))

describe('integration OAuth callback route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('redirects invalid callbacks without creating a connection', async () => {
    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/integrations/oauth/google/callback?error=access_denied'
    ) as NextRequest

    const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })
    const location = new URL(response.headers.get('location') as string)

    expect(response.status).toBe(307)
    expect(location.origin).toBe('https://app.example.com')
    expect(location.pathname).toBe('/dashboard/lumaleasing')
    expect(location.searchParams.get('error')).toBe('access_denied')
  })
})
