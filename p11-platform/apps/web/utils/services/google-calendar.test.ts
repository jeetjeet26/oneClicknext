import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createServiceClientMock = vi.fn()
const fetchMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

describe('google calendar service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('normalizes nullable calendar config fields into safe defaults', async () => {
    createServiceClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'calendar-1',
                  property_id: 'property-1',
                  google_email: 'leasing@example.com',
                  calendar_id: null,
                  access_token: 'access-token',
                  refresh_token: 'refresh-token',
                  token_expires_at: '2099-01-01T00:00:00.000Z',
                  working_hours: null,
                  tour_duration_minutes: null,
                  buffer_minutes: null,
                  timezone: null,
                  token_status: null,
                },
                error: null,
              }),
            })),
          })),
        })),
      })),
    })

    const { getCalendarConfig } = await import('./google-calendar')
    const config = await getCalendarConfig('property-1')

    expect(config).toMatchObject({
      id: 'calendar-1',
      property_id: 'property-1',
      google_email: 'leasing@example.com',
      calendar_id: 'primary',
      tour_duration_minutes: 30,
      buffer_minutes: 15,
      timezone: 'America/Chicago',
      token_status: 'healthy',
    })
    expect(config?.working_hours.mon).toEqual({
      start: '09:00',
      end: '18:00',
      enabled: true,
    })
  })

  it('marks the correct local slot unavailable when a busy block overlaps it', async () => {
    const { generateAvailableSlots } = await import('./google-calendar')

    const slots = generateAvailableSlots(
      new Date('2026-03-09T00:00:00'),
      {
        id: 'calendar-1',
        property_id: 'property-1',
        google_email: 'leasing@example.com',
        calendar_id: 'primary',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_expires_at: '2099-01-01T00:00:00.000Z',
        working_hours: {
          mon: { start: '09:00', end: '12:00', enabled: true },
          tue: { start: '09:00', end: '12:00', enabled: true },
          wed: { start: '09:00', end: '12:00', enabled: true },
          thu: { start: '09:00', end: '12:00', enabled: true },
          fri: { start: '09:00', end: '12:00', enabled: true },
          sat: { start: '09:00', end: '12:00', enabled: false },
          sun: { start: '09:00', end: '12:00', enabled: false },
        },
        tour_duration_minutes: 60,
        buffer_minutes: 0,
        timezone: 'America/New_York',
        token_status: 'healthy',
        watch_channel_id: null,
        watch_last_message_number: null,
        watch_resource_id: null,
        watch_expiration: null,
      },
      [
        {
          start: '2026-03-09T14:00:00.000Z',
          end: '2026-03-09T15:00:00.000Z',
        },
      ]
    )

    expect(slots).toEqual([
      { time: '09:00', available: true },
      { time: '10:00', available: false },
      { time: '11:00', available: true },
    ])
  })

  it('creates Google Calendar events using local wall-clock times', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: 'event-1',
        htmlLink: 'https://calendar.google.com/event',
      }),
    })

    const { createCalendarEvent } = await import('./google-calendar')
    const result = await createCalendarEvent(
      {
        id: 'calendar-1',
        property_id: 'property-1',
        google_email: 'leasing@example.com',
        calendar_id: 'primary',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_expires_at: '2099-01-01T00:00:00.000Z',
        working_hours: {
          mon: { start: '09:00', end: '18:00', enabled: true },
          tue: { start: '09:00', end: '18:00', enabled: true },
          wed: { start: '09:00', end: '18:00', enabled: true },
          thu: { start: '09:00', end: '18:00', enabled: true },
          fri: { start: '09:00', end: '18:00', enabled: true },
          sat: { start: '10:00', end: '16:00', enabled: true },
          sun: { start: '00:00', end: '00:00', enabled: false },
        },
        tour_duration_minutes: 45,
        buffer_minutes: 15,
        timezone: 'America/Chicago',
        token_status: 'healthy',
        watch_channel_id: null,
        watch_last_message_number: null,
        watch_resource_id: null,
        watch_expiration: null,
      },
      {
        propertyName: 'The Beacon',
        prospectName: 'Jane Doe',
        prospectEmail: 'jane@example.com',
        tourDate: '2026-03-21',
        tourTime: '10:00',
      }
    )

    expect(result).toEqual({
      eventId: 'event-1',
      htmlLink: 'https://calendar.google.com/event',
    })

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(requestInit.body as string)

    expect(body.start).toEqual({
      dateTime: '2026-03-21T10:00:00',
      timeZone: 'America/Chicago',
    })
    expect(body.end).toEqual({
      dateTime: '2026-03-21T10:45:00',
      timeZone: 'America/Chicago',
    })
  })

  it('reads remote Google Calendar event timing for mutation ingestion', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: 'event-1',
        status: 'confirmed',
        start: { dateTime: '2026-03-21T10:00:00' },
        end: { dateTime: '2026-03-21T10:45:00' },
      }),
    })

    const { getCalendarEvent } = await import('./google-calendar')
    const event = await getCalendarEvent(
      {
        id: 'calendar-1',
        property_id: 'property-1',
        google_email: 'leasing@example.com',
        calendar_id: 'primary',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_expires_at: '2099-01-01T00:00:00.000Z',
        working_hours: {
          mon: { start: '09:00', end: '18:00', enabled: true },
          tue: { start: '09:00', end: '18:00', enabled: true },
          wed: { start: '09:00', end: '18:00', enabled: true },
          thu: { start: '09:00', end: '18:00', enabled: true },
          fri: { start: '09:00', end: '18:00', enabled: true },
          sat: { start: '10:00', end: '16:00', enabled: true },
          sun: { start: '00:00', end: '00:00', enabled: false },
        },
        tour_duration_minutes: 45,
        buffer_minutes: 15,
        timezone: 'America/Chicago',
        token_status: 'healthy',
        watch_channel_id: null,
        watch_last_message_number: null,
        watch_resource_id: null,
        watch_expiration: null,
      },
      'event-1'
    )

    expect(event).toEqual({
      id: 'event-1',
      status: 'confirmed',
      startDateTime: '2026-03-21T10:00:00',
      endDateTime: '2026-03-21T10:45:00',
    })
  })
})
