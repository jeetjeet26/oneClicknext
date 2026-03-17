import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createServiceClientMock = vi.fn()
const verifySignedGmailOAuthStateMock = vi.fn()
const fetchMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/gmail-oauth-state', () => ({
  verifySignedGmailOAuthState: verifySignedGmailOAuthStateMock,
}))

describe('Gmail callback route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-client-secret')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('redirects with invalid_state when the state signature is bad', async () => {
    verifySignedGmailOAuthStateMock.mockImplementation(() => {
      throw new Error('Invalid OAuth state signature')
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/email/callback?code=test-code&state=bad-state'
    ) as NextRequest

    const response = await GET(request)
    const location = new URL(response.headers.get('location') as string)

    expect(response.status).toBe(307)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(location.origin).toBe('https://app.example.com')
    expect(location.pathname).toBe('/dashboard/lumaleasing')
    expect(location.searchParams.get('error')).toBe('invalid_state')
  })

  it('redirects when the signed state no longer maps to valid property access', async () => {
    verifySignedGmailOAuthStateMock.mockReturnValue({
      propertyId: 'property-1',
      profileId: 'profile-1',
      timestamp: Date.now(),
    })
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { org_id: 'org-1' },
                  error: null,
                }),
              })),
            })),
          }
        }

        if (table === 'properties') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { org_id: 'org-2' },
                  error: null,
                }),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/email/callback?code=test-code&state=signed-state'
    ) as NextRequest

    const response = await GET(request)
    const location = new URL(response.headers.get('location') as string)

    expect(response.status).toBe(307)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(location.searchParams.get('error')).toBe('state_access_invalid')
  })

  it('stores tokens and redirects successfully after OAuth completes', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { org_id: 'org-1' },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'properties') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { org_id: 'org-1' },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'email_configurations') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'email-config-1' },
                  error: null,
                }),
              })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              error: null,
            }),
          })),
        }
      }

      if (table === 'lumaleasing_config') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              error: null,
            }),
          })),
        }
      }

      throw new Error(`Unexpected table ${table}`)
    })

    verifySignedGmailOAuthStateMock.mockReturnValue({
      propertyId: 'property-1',
      profileId: 'profile-1',
      timestamp: Date.now(),
    })
    createServiceClientMock.mockReturnValue({
      from: fromMock,
    })
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          email: 'leasing@example.com',
        }),
      })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/email/callback?code=test-code&state=signed-state'
    ) as NextRequest

    const response = await GET(request)
    const location = new URL(response.headers.get('location') as string)

    expect(response.status).toBe(307)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(location.origin).toBe('https://app.example.com')
    expect(location.pathname).toBe('/dashboard/lumaleasing')
    expect(location.searchParams.get('success')).toBe('email_connected')
    expect(location.searchParams.get('email')).toBe('leasing@example.com')
    expect(location.searchParams.get('error')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fromMock).toHaveBeenCalledWith('lumaleasing_config')
  })
})
