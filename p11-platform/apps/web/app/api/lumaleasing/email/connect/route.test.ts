import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const createSignedGmailOAuthStateMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/gmail-oauth-state', () => ({
  createSignedGmailOAuthState: createSignedGmailOAuthStateMock,
}))

describe('Gmail connect route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client-id')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')
    createSignedGmailOAuthStateMock.mockReturnValue('signed-state')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('returns 401 when unauthorized', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/email/connect?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when the user cannot access the property', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/email/connect?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(403)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('redirects to Google with a signed state payload', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/email/connect?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)
    const location = response.headers.get('location')

    expect(response.status).toBe(307)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(createSignedGmailOAuthStateMock).toHaveBeenCalledWith({
      propertyId: 'property-1',
      profileId: 'user-1',
    })
    expect(location).toBeTruthy()

    const redirectUrl = new URL(location as string)
    expect(redirectUrl.origin).toBe('https://accounts.google.com')
    expect(redirectUrl.searchParams.get('client_id')).toBe('google-client-id')
    expect(redirectUrl.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/api/lumaleasing/email/callback'
    )
    expect(redirectUrl.searchParams.get('state')).toBe('signed-state')
  })
})
