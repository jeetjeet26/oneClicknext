import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const getCalendarConfigMock = vi.fn()
const updateCalendarEventMock = vi.fn()
const createCalendarEventMock = vi.fn()
const cancelCalendarEventMock = vi.fn()

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
  updateCalendarEvent: updateCalendarEventMock,
  createCalendarEvent: createCalendarEventMock,
  cancelCalendarEvent: cancelCalendarEventMock,
}))

describe('LumaLeasing tour recovery route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('GET returns 401 when unauthorized', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/tours/recovery?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)
    expect(response.status).toBe(401)
  })

  it('GET returns recoverable bookings with calendar and lead metadata', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId: 'org-1' })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'tour_bookings') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn().mockResolvedValue({
                      data: [
                        {
                          id: 'booking-1',
                          property_id: 'property-1',
                          lead_id: 'lead-1',
                          scheduled_date: '2026-03-25',
                          scheduled_time: '10:00:00',
                          duration_minutes: 30,
                          status: 'confirmed',
                          special_requests: null,
                        },
                      ],
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
          }
        }

        if (table === 'calendar_events') {
          return {
            select: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'cal-1',
                    tour_booking_id: 'booking-1',
                    google_event_id: 'google-1',
                    sync_status: 'synced',
                  },
                ],
                error: null,
              }),
            })),
          }
        }

        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
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
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/tours/recovery?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.bookings).toHaveLength(1)
    expect(json.bookings[0]).toMatchObject({
      id: 'booking-1',
      can_cancel: true,
      can_reschedule: true,
      lead: { name: 'Jane Doe', email: 'jane@example.com' },
      calendar_event: { id: 'cal-1', google_event_id: 'google-1', sync_status: 'synced' },
    })
  })

  it('POST cancels a booking and marks calendar event cancelled', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId: 'org-1' })
    getCalendarConfigMock.mockResolvedValue({
      id: 'calendar-1',
      token_status: 'healthy',
      calendar_id: 'primary',
      timezone: 'America/Chicago',
      access_token: 'token',
      refresh_token: 'refresh',
      token_expires_at: '2099-01-01T00:00:00.000Z',
    })

    const bookingUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const calendarUpdateEq = vi.fn().mockResolvedValue({ error: null })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'tour_bookings') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'booking-1',
                      property_id: 'property-1',
                      lead_id: 'lead-1',
                      scheduled_date: '2026-03-26',
                      scheduled_time: '10:00:00',
                      duration_minutes: 30,
                      status: 'confirmed',
                      special_requests: null,
                    },
                    error: null,
                  }),
                })),
              })),
            })),
            update: vi.fn((payload: unknown) => {
              expect(payload).toMatchObject({ status: 'cancelled' })
              return { eq: bookingUpdateEq }
            }),
          }
        }

        if (table === 'properties') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { name: 'The Beacon', address: { street: '123 Main St' } },
                  error: null,
                }),
              })),
            })),
          }
        }

        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    first_name: 'Jane',
                    last_name: 'Doe',
                    email: 'jane@example.com',
                    phone: '555-111-2222',
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
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'cal-1',
                    google_event_id: 'google-1',
                    sync_status: 'synced',
                  },
                  error: null,
                }),
              })),
            })),
            update: vi.fn((payload: unknown) => {
              expect(payload).toMatchObject({ sync_status: 'external_cancelled' })
              return { eq: calendarUpdateEq }
            }),
          }
        }

        if (table === 'lead_activities') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/tours/recovery', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        propertyId: 'property-1',
        bookingId: 'booking-1',
        action: 'cancel',
        reason: 'Lead requested cancellation',
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      success: true,
      bookingId: 'booking-1',
      action: 'cancel',
      calendarAction: 'cancelled',
    })
    expect(cancelCalendarEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'calendar-1' }),
      'google-1'
    )
    expect(bookingUpdateEq).toHaveBeenCalledWith('id', 'booking-1')
    expect(calendarUpdateEq).toHaveBeenCalledWith('id', 'cal-1')
  })
})
