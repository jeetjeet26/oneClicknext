import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const createSignedIntegrationOAuthStateMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/integration-oauth-state', () => ({
  createSignedIntegrationOAuthState: createSignedIntegrationOAuthStateMock,
}))

vi.mock('@/utils/services/integration-auth-invites', () => ({
  getValidIntegrationAuthInviteByToken: vi.fn(),
}))

describe('integration OAuth start route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubEnv('MICROSOFT_CLIENT_ID', 'microsoft-client-id')
    vi.stubEnv('MICROSOFT_TENANT_ID', 'tenant-1')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')
    createSignedIntegrationOAuthStateMock.mockReturnValue('signed-state')
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('redirects dashboard Microsoft calendar auth to the Microsoft consent screen', async () => {
    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/integrations/oauth/microsoft/start?propertyId=property-1&capabilities=calendar'
    ) as NextRequest

    const response = await GET(request, { params: Promise.resolve({ provider: 'microsoft' }) })
    const location = new URL(response.headers.get('location') as string)

    expect(response.status).toBe(307)
    expect(location.origin).toBe('https://login.microsoftonline.com')
    expect(location.pathname).toContain('/tenant-1/')
    expect(location.searchParams.get('client_id')).toBe('microsoft-client-id')
    expect(location.searchParams.get('state')).toBe('signed-state')
    expect(createSignedIntegrationOAuthStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: 'property-1',
        provider: 'microsoft',
        capabilities: ['calendar'],
        authSource: 'dashboard',
        profileId: 'user-1',
      })
    )
  })

  it('includes Google identity scopes for dashboard Google calendar auth', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client-id')

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/integrations/oauth/google/start?propertyId=property-1&capabilities=calendar'
    ) as NextRequest

    const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })
    const location = new URL(response.headers.get('location') as string)
    const scope = location.searchParams.get('scope') || ''

    expect(response.status).toBe(307)
    expect(location.origin).toBe('https://accounts.google.com')
    expect(scope).toContain('openid')
    expect(scope).toContain('email')
    expect(scope).toContain('profile')
    expect(scope).toContain('https://www.googleapis.com/auth/calendar')
  })

  it('fails Microsoft auth clearly when tenant id is not configured', async () => {
    vi.stubEnv('MICROSOFT_TENANT_ID', '')

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/integrations/oauth/microsoft/start?propertyId=property-1&capabilities=calendar'
    ) as NextRequest

    const response = await GET(request, { params: Promise.resolve({ provider: 'microsoft' }) })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' })
  })
})
