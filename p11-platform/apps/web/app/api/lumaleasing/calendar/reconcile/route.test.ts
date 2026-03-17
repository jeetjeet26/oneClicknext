import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const getCalendarConfigMock = vi.fn()
const createCalendarEventMock = vi.fn()
const updateCalendarEventMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/google-calendar', () => ({
  getCalendarConfig: getCalendarConfigMock,
  createCalendarEvent: createCalendarEventMock,
  updateCalendarEvent: updateCalendarEventMock,
}))

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as NextRequest
}

describe('lumaleasing calendar reconcile route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/lumaleasing/calendar/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: 'property-1' }),
      })
    )

    expect(response.status).toBe(401)
  })

  it('returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/lumaleasing/calendar/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: 'property-1' }),
      })
    )

    expect(response.status).toBe(403)
  })

  it('creates missing calendar sync rows for active bookings', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    getCalendarConfigMock.mockResolvedValue({
      id: 'calendar-1',
      property_id: 'property-1',
      google_email: 'leasing@example.com',
      calendar_id: 'primary',
      access_token: 'token',
      refresh_token: 'refresh',
      token_expires_at: '2099-01-01T00:00:00.000Z',
      working_hours: {},
      tour_duration_minutes: 30,
      buffer_minutes: 15,
      timezone: 'America/Chicago',
      token_status: 'healthy',
    })
    createCalendarEventMock.mockResolvedValue({
      eventId: 'google-event-1',
      htmlLink: 'https://calendar.google.com/event-1',
    })

    const insertCalendarEventMock = vi.fn().mockResolvedValue({ error: null })
    const serviceFromMock = vi.fn((table: string) => {
      if (table === 'properties') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { name: 'Sunset Apartments', address: { street: '123 Main St' } },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'tour_bookings') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'booking-1',
                      property_id: 'property-1',
                      lead_id: 'lead-1',
                      scheduled_date: '2026-04-01',
                      scheduled_time: '14:30:00',
                      special_requests: 'Show the pool',
                      status: 'confirmed',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'calendar_events') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }),
          }),
          insert: insertCalendarEventMock,
        }
      }
      if (table === 'leads') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'lead-1',
                  first_name: 'Jane',
                  last_name: 'Doe',
                  email: 'jane@example.com',
                  phone: '555-111-2222',
                },
              ],
              error: null,
            }),
          }),
        }
      }
      if (table === 'lead_activities') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })
    createServiceClientMock.mockReturnValue({
      from: serviceFromMock,
    })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/lumaleasing/calendar/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: 'property-1' }),
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      activeBookings: 1,
      created: 1,
      repaired: 0,
      failed: 0,
      alreadySynced: 0,
      skipped: 0,
    })
    expect(createCalendarEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'calendar-1' }),
      expect.objectContaining({
        propertyName: 'Sunset Apartments',
        prospectName: 'Jane Doe',
        prospectEmail: 'jane@example.com',
        tourDate: '2026-04-01',
        tourTime: '14:30',
      })
    )
    expect(insertCalendarEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_calendar_id: 'calendar-1',
        tour_booking_id: 'booking-1',
        google_event_id: 'google-event-1',
        sync_status: 'synced',
      })
    )
  })

  it('recreates failed calendar events when the remote event no longer exists', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    getCalendarConfigMock.mockResolvedValue({
      id: 'calendar-1',
      property_id: 'property-1',
      google_email: 'leasing@example.com',
      calendar_id: 'primary',
      access_token: 'token',
      refresh_token: 'refresh',
      token_expires_at: '2099-01-01T00:00:00.000Z',
      working_hours: {},
      tour_duration_minutes: 30,
      buffer_minutes: 15,
      timezone: 'America/Chicago',
      token_status: 'healthy',
    })
    updateCalendarEventMock.mockRejectedValue(new Error('Failed to update calendar event: 404'))
    createCalendarEventMock.mockResolvedValue({
      eventId: 'google-event-new',
      htmlLink: 'https://calendar.google.com/event-new',
    })

    const calendarEventUpdateEqMock = vi.fn().mockResolvedValue({ error: null })
    const calendarEventUpdateMock = vi.fn().mockReturnValue({
      eq: calendarEventUpdateEqMock,
    })
    const serviceFromMock = vi.fn((table: string) => {
      if (table === 'properties') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { name: 'Sunset Apartments', address: { full: '123 Main St' } },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'tour_bookings') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'booking-1',
                      property_id: 'property-1',
                      lead_id: 'lead-1',
                      scheduled_date: '2026-04-01',
                      scheduled_time: '14:30:00',
                      special_requests: null,
                      status: 'confirmed',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'calendar_events') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'calendar-event-1',
                    tour_booking_id: 'booking-1',
                    google_event_id: 'google-event-old',
                    sync_status: 'failed',
                  },
                ],
                error: null,
              }),
            }),
          }),
          update: calendarEventUpdateMock,
        }
      }
      if (table === 'leads') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'lead-1',
                  first_name: 'Jane',
                  last_name: 'Doe',
                  email: 'jane@example.com',
                  phone: null,
                },
              ],
              error: null,
            }),
          }),
        }
      }
      if (table === 'lead_activities') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })
    createServiceClientMock.mockReturnValue({
      from: serviceFromMock,
    })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/lumaleasing/calendar/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: 'property-1' }),
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      created: 0,
      repaired: 1,
      failed: 0,
    })
    expect(updateCalendarEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'calendar-1' }),
      'google-event-old',
      expect.objectContaining({ prospectEmail: 'jane@example.com' })
    )
    expect(calendarEventUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        google_event_id: 'google-event-new',
        sync_status: 'synced',
      })
    )
    expect(calendarEventUpdateEqMock).toHaveBeenCalledWith('id', 'calendar-event-1')
  })
})
