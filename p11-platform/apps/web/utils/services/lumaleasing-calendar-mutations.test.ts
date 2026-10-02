import { beforeEach, describe, expect, it, vi } from 'vitest'

const createServiceClientMock = vi.fn()
const recordMock=vi.fn()
const getCalendarConfigMock = vi.fn()
const getCalendarEventMock = vi.fn()
const ensureCalendarWatchMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/google-calendar', () => ({
  buildTourEventDateTimes: vi.fn((_config, date: string, time: string) => ({
    startInstant: `${date}T${time}:00`,
    endInstant: `${date}T11:00:00`,
  })),
  ensureCalendarWatch: ensureCalendarWatchMock,
  getCalendarConfig: getCalendarConfigMock,
  getCalendarEvent: getCalendarEventMock,
}))

describe('lumaleasing calendar mutations service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    recordMock.mockResolvedValue({data:'recorded',error:null})
    ensureCalendarWatchMock.mockResolvedValue(null)
  })

  it('holds a missing remote event for review without cancelling the booking', async () => {
    getCalendarConfigMock.mockResolvedValue({
      id: 'calendar-1',
      property_id: 'property-1',
      google_email: 'leasing@example.com',
      calendar_id: 'primary',
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_expires_at: '2099-01-01T00:00:00.000Z',
      working_hours: {},
      tour_duration_minutes: 60,
      buffer_minutes: 15,
      timezone: 'America/Chicago',
      token_status: 'healthy',
    })
    getCalendarEventMock.mockResolvedValue(null)

    const bookingUpdateEqMock = vi.fn().mockResolvedValue({ error: null })
    const bookingUpdateMock = vi.fn().mockReturnValue({ eq: bookingUpdateEqMock })
    const calendarEventEqMock = vi.fn().mockResolvedValue({ error: null })
    const calendarEventUpdateMock = vi.fn().mockReturnValue({ eq: calendarEventEqMock })
    const leadUpdateEqMock = vi.fn().mockResolvedValue({ error: null })
    const leadUpdateMock = vi.fn().mockReturnValue({ eq: leadUpdateEqMock })
    const leadActivityInsertMock = vi.fn().mockResolvedValue({ error: null })
    createServiceClientMock.mockReturnValue({
      rpc:recordMock,
      from: vi.fn((table: string) => {
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
                        scheduled_time: '10:00:00',
                        status: 'confirmed',
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
            update: bookingUpdateMock,
          }
        }
        if (table === 'calendar_events') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'calendar-event-1',
                    tour_booking_id: 'booking-1',
                    google_event_id: 'google-event-1',
                    sync_status: 'synced',
                  },
                ],
                error: null,
              }),
            }),
            update: calendarEventUpdateMock,
          }
        }
        if (table === 'tours') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'leads') {
          return {
            update: leadUpdateMock,
          }
        }
        if (table === 'lead_activities') {
          return {
            insert: leadActivityInsertMock,
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { ingestExternalCalendarMutationsForProperty } = await import(
      './lumaleasing-calendar-mutations'
    )
    const result = await ingestExternalCalendarMutationsForProperty('property-1')

    expect(result).toEqual({
      propertyId: 'property-1',
      checked: 1,
      skipped: 0,
      healthy: 0,
      drifted: 0,
      missing: 1,
      cancelled: 0,
    })
    expect(bookingUpdateMock).not.toHaveBeenCalled()
    expect(leadUpdateMock).not.toHaveBeenCalled()
    expect(leadActivityInsertMock).not.toHaveBeenCalled()
    expect(recordMock).toHaveBeenCalledWith('record_tour_calendar_observation',expect.objectContaining({p_status:'external_missing'}))

  })

  it('holds remote drift for review without bypassing local capacity', async () => {
    getCalendarConfigMock.mockResolvedValue({
      id: 'calendar-1',
      property_id: 'property-1',
      google_email: 'leasing@example.com',
      calendar_id: 'primary',
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_expires_at: '2099-01-01T00:00:00.000Z',
      working_hours: {},
      tour_duration_minutes: 60,
      buffer_minutes: 15,
      timezone: 'America/Chicago',
      token_status: 'healthy',
    })
    getCalendarEventMock.mockResolvedValue({
      id: 'google-event-1',
      status: 'confirmed',
      startDateTime: '2026-04-02T15:30:00Z',
      endDateTime: '2026-04-02T16:30:00Z',
    })

    const bookingUpdateEqMock = vi.fn().mockResolvedValue({ error: null })
    const bookingUpdateMock = vi.fn().mockReturnValue({ eq: bookingUpdateEqMock })
    const calendarEventEqMock = vi.fn().mockResolvedValue({ error: null })
    const calendarEventUpdateMock = vi.fn().mockReturnValue({ eq: calendarEventEqMock })
    const leadActivityInsertMock = vi.fn().mockResolvedValue({ error: null })
    createServiceClientMock.mockReturnValue({
      rpc:recordMock,
      from: vi.fn((table: string) => {
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
                        scheduled_time: '10:00:00',
                        status: 'confirmed',
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
            update: bookingUpdateMock,
          }
        }
        if (table === 'calendar_events') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'calendar-event-1',
                    tour_booking_id: 'booking-1',
                    google_event_id: 'google-event-1',
                    sync_status: 'synced',
                  },
                ],
                error: null,
              }),
            }),
            update: calendarEventUpdateMock,
          }
        }
        if (table === 'lead_activities') {
          return {
            insert: leadActivityInsertMock,
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { ingestExternalCalendarMutationsForProperty } = await import(
      './lumaleasing-calendar-mutations'
    )
    const result = await ingestExternalCalendarMutationsForProperty('property-1')

    expect(result).toEqual({
      propertyId: 'property-1',
      checked: 1,
      skipped: 0,
      healthy: 0,
      drifted: 1,
      missing: 0,
      cancelled: 0,
    })
    expect(bookingUpdateMock).not.toHaveBeenCalled()
    expect(leadActivityInsertMock).not.toHaveBeenCalled()
    expect(recordMock).toHaveBeenCalledWith('record_tour_calendar_observation',expect.objectContaining({p_status:'external_drift'}))

  })
})
