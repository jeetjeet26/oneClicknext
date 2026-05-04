import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createServiceClientMock = vi.fn()
const generateTourCalendarResponseMock = vi.fn()
const sendEmailMock = vi.fn()
const getCalendarConfigMock = vi.fn()
const createCalendarEventMock = vi.fn()
const fetchBusyTimesMock = vi.fn()
const generateAvailableSlotsMock = vi.fn()
const startWorkflowMock = vi.fn()
const trackEngagementEventMock = vi.fn()
const getRateLimitKeyMock = vi.fn()
const rateLimitHeadersMock = vi.fn()
const tourLimiterCheckMock = vi.fn()
const auditLogMock = vi.fn()
const getRequestIpMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/calendar-invite', () => ({
  generateTourCalendarResponse: generateTourCalendarResponseMock,
}))

vi.mock('@/utils/services/messaging', () => ({
  sendEmail: sendEmailMock,
}))

vi.mock('@/utils/services/google-calendar', () => ({
  getCalendarConfig: getCalendarConfigMock,
  createCalendarEvent: createCalendarEventMock,
  fetchBusyTimes: fetchBusyTimesMock,
  generateAvailableSlots: generateAvailableSlotsMock,
}))

vi.mock('@/utils/services/workflow-processor', () => ({
  startWorkflow: startWorkflowMock,
}))

vi.mock('@/utils/services/engagement-tracker', () => ({
  trackEngagementEvent: trackEngagementEventMock,
}))

vi.mock('@/utils/services/rate-limiter', () => ({
  tourLimiter: {
    check: tourLimiterCheckMock,
  },
  getRateLimitKey: getRateLimitKeyMock,
  rateLimitHeaders: rateLimitHeadersMock,
}))

vi.mock('@/utils/services/audit-logger', () => ({
  auditLog: auditLogMock,
  getRequestIp: getRequestIpMock,
}))

describe('LumaLeasing tours route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'))
    getRateLimitKeyMock.mockReturnValue('tour-key')
    tourLimiterCheckMock.mockReturnValue({
      allowed: true,
      remaining: 9,
      resetAt: Date.now() + 60_000,
    })
    rateLimitHeadersMock.mockReturnValue({})
    generateTourCalendarResponseMock.mockReturnValue({
      calendarLinks: {
        google: 'google-link',
        outlook: 'outlook-link',
        office365: 'office-link',
        yahoo: 'yahoo-link',
        icsDownload: 'ics-link',
      },
      icsAttachment: {
        filename: 'tour.ics',
        content: 'BEGIN:VCALENDAR...',
        contentType: 'text/calendar',
      },
    })
    sendEmailMock.mockResolvedValue({ success: true })
    getCalendarConfigMock.mockResolvedValue({
      id: 'calendar-1',
      property_id: 'property-1',
      google_email: 'leasing@example.com',
      calendar_id: 'primary',
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_expires_at: '2099-01-01T00:00:00.000Z',
      working_hours: {
        mon: { start: '09:00', end: '17:00', enabled: true },
        tue: { start: '09:00', end: '17:00', enabled: true },
        wed: { start: '09:00', end: '17:00', enabled: true },
        thu: { start: '09:00', end: '17:00', enabled: true },
        fri: { start: '09:00', end: '17:00', enabled: true },
        sat: { start: '10:00', end: '14:00', enabled: true },
        sun: { start: '00:00', end: '00:00', enabled: false },
      },
      tour_duration_minutes: 45,
      buffer_minutes: 15,
      timezone: 'America/Chicago',
      token_status: 'healthy',
    })
    createCalendarEventMock.mockResolvedValue({ eventId: 'event-1' })
    fetchBusyTimesMock.mockResolvedValue([])
    generateAvailableSlotsMock.mockReturnValue([
      { time: '10:00', available: true },
    ])
    startWorkflowMock.mockResolvedValue({ success: true })
    trackEngagementEventMock.mockReturnValue(Promise.resolve())
    auditLogMock.mockImplementation(() => {})
    getRequestIpMock.mockReturnValue('127.0.0.1')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns available tour slots for a valid API key', async () => {
    const configSingle = vi.fn().mockResolvedValue({
      data: {
        property_id: 'property-1',
        tours_enabled: true,
        tour_duration_minutes: 30,
      },
    })
    const slotsOrderTime = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'slot-1',
          slot_date: '2026-03-20',
          start_time: '10:00:00',
          end_time: '10:30:00',
          max_bookings: 4,
          current_bookings: 1,
        },
        {
          id: 'slot-2',
          slot_date: '2026-03-20',
          start_time: '11:00:00',
          end_time: '11:30:00',
          max_bookings: 4,
          current_bookings: 4,
        },
      ],
      error: null,
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: configSingle,
                })),
              })),
            })),
          }
        }

        if (table === 'tour_slots') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  gte: vi.fn(() => ({
                    lte: vi.fn(() => ({
                      order: vi.fn(() => ({
                        order: slotsOrderTime,
                      })),
                    })),
                  })),
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
      'http://localhost/api/lumaleasing/tours?apiKey=test-key&startDate=2026-03-20&endDate=2026-03-21',
      { method: 'GET', headers: { origin: 'http://localhost:3000' } }
    ) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toEqual({
      slots: {
        '2026-03-20': [
          {
            id: 'slot-1',
            date: '2026-03-20',
            startTime: '10:00:00',
            endTime: '10:30:00',
            available: 3,
          },
        ],
      },
      tourDuration: 30,
    })
  })

  it('books a tour and returns calendar links', async () => {
    const configSingle = vi.fn().mockResolvedValue({
      data: {
        property_id: 'property-1',
        tours_enabled: true,
        tour_duration_minutes: 45,
        properties: {
          id: 'property-1',
          name: 'The Beacon',
          address: { street: '123 Main St' },
          website_url: 'https://example.com',
        },
      },
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: configSingle,
                })),
              })),
            })),
          }
        }

        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({ data: null }),
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'lead-1' },
                }),
              })),
            })),
          }
        }

        if (table === 'tour_bookings') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      in: vi.fn(() => ({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: null,
                          error: null,
                        }),
                      })),
                    })),
                  })),
                })),
              })),
            })),
            insert: vi.fn((payload: unknown) => {
              expect(payload).toMatchObject({
                duration_minutes: 45,
              })

              return {
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: 'booking-1',
                      scheduled_date: '2026-03-21',
                      scheduled_time: '10:00',
                      status: 'confirmed',
                      duration_minutes: 45,
                    },
                    error: null,
                  }),
                })),
              }
            }),
          }
        }

        if (table === 'lead_activities') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }

        if (table === 'widget_sessions') {
          return {
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        }

        if (table === 'calendar_events') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/lumaleasing/tours?apiKey=test-key', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        tourDate: '2026-03-21',
        tourTime: '10:00',
        leadInfo: {
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          phone: '555-111-2222',
        },
        specialRequests: 'Show me the gym',
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toMatchObject({
      success: true,
      booking: {
        id: 'booking-1',
        date: '2026-03-21',
        time: '10:00',
        status: 'confirmed',
      },
      calendar: {
        google: 'google-link',
        outlook: 'outlook-link',
        office365: 'office-link',
        yahoo: 'yahoo-link',
        icsDownload: 'ics-link',
      },
    })

    expect(startWorkflowMock).toHaveBeenCalledWith(
      'lead-1',
      'property-1',
      'lead_created'
    )
    expect(trackEngagementEventMock).toHaveBeenCalledWith({
      leadId: 'lead-1',
      propertyId: 'property-1',
      eventType: 'tour_scheduled',
      metadata: {
        booking_id: 'booking-1',
        source: 'lumaleasing_tour_widget',
      },
    })
    expect(sendEmailMock).toHaveBeenCalled()
    expect(createCalendarEventMock).toHaveBeenCalled()
  })

  it('still confirms a booking when Google Calendar event creation fails', async () => {
    const calendarEventsInsert = vi.fn().mockResolvedValue({ error: null })
    const configSingle = vi.fn().mockResolvedValue({
      data: {
        property_id: 'property-1',
        tours_enabled: true,
        tour_duration_minutes: 45,
        properties: {
          id: 'property-1',
          name: 'The Beacon',
          address: { street: '123 Main St' },
          website_url: 'https://example.com',
        },
      },
    })

    createCalendarEventMock.mockRejectedValueOnce(new Error('calendar provider unavailable'))

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: configSingle,
                })),
              })),
            })),
          }
        }

        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({ data: null }),
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'lead-1' },
                }),
              })),
            })),
          }
        }

        if (table === 'tour_bookings') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      in: vi.fn(() => ({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: null,
                          error: null,
                        }),
                      })),
                    })),
                  })),
                })),
              })),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'booking-1',
                    scheduled_date: '2026-03-21',
                    scheduled_time: '10:00',
                    status: 'confirmed',
                    duration_minutes: 45,
                  },
                  error: null,
                }),
              })),
            })),
          }
        }

        if (table === 'lead_activities') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }

        if (table === 'widget_sessions') {
          return {
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        }

        if (table === 'calendar_events') {
          return {
            insert: calendarEventsInsert,
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/lumaleasing/tours?apiKey=test-key', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        tourDate: '2026-03-21',
        tourTime: '10:00',
        leadInfo: {
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          phone: '555-111-2222',
        },
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toMatchObject({
      success: true,
      booking: {
        id: 'booking-1',
        status: 'confirmed',
      },
    })
    expect(createCalendarEventMock).toHaveBeenCalled()
    expect(calendarEventsInsert).not.toHaveBeenCalled()
    expect(sendEmailMock).toHaveBeenCalled()
  })

  it('returns the existing booking instead of creating a duplicate on retry', async () => {
    const leadInsertMock = vi.fn()
    const bookingInsertMock = vi.fn()
    const leadActivitiesInsertMock = vi.fn()
    const calendarEventsInsertMock = vi.fn()

    const configSingle = vi.fn().mockResolvedValue({
      data: {
        property_id: 'property-1',
        tours_enabled: true,
        tour_duration_minutes: 45,
        properties: {
          id: 'property-1',
          name: 'The Beacon',
          address: { street: '123 Main St' },
          website_url: 'https://example.com',
        },
      },
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: configSingle,
                })),
              })),
            })),
          }
        }

        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({ data: { id: 'lead-1' } }),
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
            insert: leadInsertMock,
          }
        }

        if (table === 'tour_bookings') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      in: vi.fn(() => ({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: {
                            id: 'booking-existing',
                            scheduled_date: '2026-03-21',
                            scheduled_time: '10:00',
                            status: 'confirmed',
                            duration_minutes: 45,
                          },
                          error: null,
                        }),
                      })),
                    })),
                  })),
                })),
              })),
            })),
            insert: bookingInsertMock,
          }
        }

        if (table === 'lead_activities') {
          return {
            insert: leadActivitiesInsertMock,
          }
        }

        if (table === 'calendar_events') {
          return {
            insert: calendarEventsInsertMock,
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/lumaleasing/tours?apiKey=test-key', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        tourDate: '2026-03-21',
        tourTime: '10:00',
        leadInfo: {
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          phone: '555-111-2222',
        },
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toMatchObject({
      success: true,
      duplicate: true,
      booking: {
        id: 'booking-existing',
        date: '2026-03-21',
        time: '10:00',
        status: 'confirmed',
      },
    })
    expect(leadInsertMock).not.toHaveBeenCalled()
    expect(bookingInsertMock).not.toHaveBeenCalled()
    expect(leadActivitiesInsertMock).not.toHaveBeenCalled()
    expect(calendarEventsInsertMock).not.toHaveBeenCalled()
    expect(createCalendarEventMock).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid booking payload', async () => {
    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/lumaleasing/tours?apiKey=test-key', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        tourDate: '03/21/2026',
        tourTime: '10:00',
        leadInfo: {
          email: 'jane@example.com',
        },
      }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({
      error: 'tourDate: Date must be YYYY-MM-DD',
    })
  })

  it('returns 409 when the direct booking time is no longer available', async () => {
    generateAvailableSlotsMock.mockReturnValue([
      { time: '10:00', available: false },
    ])

    const configSingle = vi.fn().mockResolvedValue({
      data: {
        property_id: 'property-1',
        tours_enabled: true,
        tour_duration_minutes: 45,
        properties: {
          id: 'property-1',
          name: 'The Beacon',
          address: { street: '123 Main St' },
          website_url: 'https://example.com',
        },
      },
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: configSingle,
                })),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/lumaleasing/tours?apiKey=test-key', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        tourDate: '2026-03-21',
        tourTime: '10:00',
        leadInfo: {
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
        },
      }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(409)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({
      error: 'This time is no longer available',
    })
  })

  it('returns 400 when the session id does not belong to the property', async () => {
    const configSingle = vi.fn().mockResolvedValue({
      data: {
        property_id: 'property-1',
        tours_enabled: true,
        tour_duration_minutes: 45,
        properties: {
          id: 'property-1',
          name: 'The Beacon',
          address: { street: '123 Main St' },
          website_url: 'https://example.com',
        },
      },
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: configSingle,
                })),
              })),
            })),
          }
        }

        if (table === 'widget_sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
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

    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/lumaleasing/tours?apiKey=test-key', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        tourDate: '2026-03-21',
        tourTime: '10:00',
        sessionId: 'foreign-session',
        leadInfo: {
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
        },
      }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid sessionId for this property',
    })
  })
})
