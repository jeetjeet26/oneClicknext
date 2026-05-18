import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

describe('Calendar status route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-10T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
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
      'http://localhost/api/lumaleasing/calendar/status?propertyId=property-1'
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
      'http://localhost/api/lumaleasing/calendar/status?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(403)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns disconnected when no calendar configuration exists', async () => {
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
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'agent_calendars') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
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
      'http://localhost/api/lumaleasing/calendar/status?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toMatchObject({
      connected: false,
      message: 'Google Calendar not connected',
      webhook_capability: {
        mode: 'unconfigured',
        ready: false,
        blockers: ['missing_calendar_connection'],
      },
    })
  })

  it('returns status metadata for a connected calendar', async () => {
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
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'agent_calendars') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'calendar-1',
                    google_email: 'leasing@example.com',
                    token_status: 'healthy',
                    last_health_check_at: '2026-03-10T00:00:00.000Z',
                    token_expires_at: '2026-03-11T00:00:00.000Z',
                    timezone: 'America/Chicago',
                    sync_enabled: true,
                    calendar_id: 'primary',
                    watch_expiration: '2026-03-20T14:00:00.000Z',
                    watch_channel_id: 'channel-1',
                    watch_resource_id: 'resource-1',
                    watch_last_message_number: 12,
                  },
                  error: null,
                }),
              })),
            })),
          }
        }

        if (table === 'calendar_events') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue({
                  data: [
                    { tour_booking_id: 'booking-1', sync_status: 'synced' },
                    { tour_booking_id: 'booking-2', sync_status: 'failed' },
                    { tour_booking_id: 'booking-4', sync_status: 'external_drift' },
                  ],
                  error: null,
                }),
              })),
            })),
          }
        }

        if (table === 'tour_bookings') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      { id: 'booking-1' },
                      { id: 'booking-2' },
                      { id: 'booking-3' },
                      { id: 'booking-4' },
                    ],
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/calendar/status?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toMatchObject({
      connected: true,
      email: 'leasing@example.com',
      token_status: 'healthy',
      timezone: 'America/Chicago',
      sync_enabled: true,
      calendar_id: 'primary',
      webhook_capability: {
        mode: 'push_watch',
        ready: true,
        blockers: [],
        watch_expires_at: '2026-03-20T14:00:00.000Z',
        watch_last_message_number: 12,
      },
      calendar_sync: {
        total_events: 3,
        synced_events: 1,
        failed_events: 1,
        external_drift_events: 1,
        external_missing_events: 0,
        external_cancelled_events: 0,
        missing_event_bookings: 1,
        degraded: true,
      },
    })
    expect(typeof json.webhook_capability?.watch_ttl_minutes).toBe('number')
    expect((json.webhook_capability?.watch_ttl_minutes ?? 0) > 0).toBe(true)
  })
})
