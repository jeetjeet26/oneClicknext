import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createServiceClientMock = vi.fn()
const verifySignedGoogleOAuthStateMock = vi.fn()
const getCalendarConfigMock = vi.fn()
const ensureCalendarWatchMock = vi.fn()
const fetchMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/google-oauth-state', () => ({
  verifySignedGoogleOAuthState: verifySignedGoogleOAuthStateMock,
}))

vi.mock('@/utils/services/google-calendar', () => ({
  getCalendarConfig: getCalendarConfigMock,
  ensureCalendarWatch: ensureCalendarWatchMock,
}))

describe('Calendar callback route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-client-secret')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')
    vi.stubGlobal('fetch', fetchMock)
    getCalendarConfigMock.mockResolvedValue({
      id: 'calendar-config-1',
      property_id: 'property-1',
      profile_id: 'profile-1',
      google_email: 'leasing@example.com',
      calendar_id: 'primary',
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_expires_at: '2099-01-01T00:00:00.000Z',
      sync_enabled: true,
      working_hours: {},
      tour_duration_minutes: 30,
      buffer_minutes: 15,
      timezone: 'America/Chicago',
      token_status: 'healthy',
      watch_channel_id: null,
      watch_last_message_number: null,
      watch_resource_id: null,
      watch_expiration: null,
    })
    ensureCalendarWatchMock.mockResolvedValue({
      channelId: 'channel-1',
      resourceId: 'resource-1',
      expiration: '2099-01-02T00:00:00.000Z',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('redirects with invalid_state when the state signature is bad', async () => {
    verifySignedGoogleOAuthStateMock.mockImplementation(() => {
      throw new Error('Invalid OAuth state signature')
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/calendar/callback?code=test-code&state=bad-state'
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
    verifySignedGoogleOAuthStateMock.mockReturnValue({
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
      'http://localhost/api/lumaleasing/calendar/callback?code=test-code&state=signed-state'
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

      if (table === 'agent_calendars') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'calendar-config-1' },
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

      throw new Error(`Unexpected table ${table}`)
    })

    verifySignedGoogleOAuthStateMock.mockReturnValue({
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
          value: 'America/Chicago',
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
      'http://localhost/api/lumaleasing/calendar/callback?code=test-code&state=signed-state'
    ) as NextRequest

    const response = await GET(request)
    const location = new URL(response.headers.get('location') as string)

    expect(response.status).toBe(307)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(location.origin).toBe('https://app.example.com')
    expect(location.pathname).toBe('/dashboard/lumaleasing')
    expect(location.searchParams.get('success')).toBe('calendar_connected')
    expect(location.searchParams.get('email')).toBe('leasing@example.com')
    expect(location.searchParams.get('error')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fromMock).toHaveBeenCalledWith('agent_calendars')
    expect(getCalendarConfigMock).toHaveBeenCalledWith('property-1')
    expect(ensureCalendarWatchMock).toHaveBeenCalled()
  })
})
