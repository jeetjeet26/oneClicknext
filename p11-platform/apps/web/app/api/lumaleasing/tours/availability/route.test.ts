import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createServiceClientMock = vi.fn()
const getCalendarConfigMock = vi.fn()
const fetchBusyTimesMock = vi.fn()
const generateAvailableSlotsMock = vi.fn()
const getRateLimitKeyMock = vi.fn()
const rateLimitHeadersMock = vi.fn()
const publicReadLimiterCheckMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/google-calendar', () => ({
  getCalendarConfig: getCalendarConfigMock,
  fetchBusyTimes: fetchBusyTimesMock,
  generateAvailableSlots: generateAvailableSlotsMock,
}))

vi.mock('@/utils/services/rate-limiter', () => ({
  publicReadLimiter: {
    check: publicReadLimiterCheckMock,
  },
  getRateLimitKey: getRateLimitKeyMock,
  rateLimitHeaders: rateLimitHeadersMock,
}))

describe('Luma tour availability route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRateLimitKeyMock.mockReturnValue('availability-key')
    publicReadLimiterCheckMock.mockReturnValue({
      allowed: true,
      remaining: 59,
      resetAt: Date.now() + 60_000,
    })
    rateLimitHeadersMock.mockReturnValue({})
    fetchBusyTimesMock.mockResolvedValue([])
    generateAvailableSlotsMock.mockReturnValue([
      { startTime: '10:00', endTime: '10:30', available: true },
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when the api key is missing', async () => {
    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/tours/availability') as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'API key required' })
  })

  it('returns 429 when tour availability requests are rate limited', async () => {
    publicReadLimiterCheckMock.mockReturnValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      retryAfterMs: 60_000,
    })
    rateLimitHeadersMock.mockReturnValue({ 'Retry-After': '60' })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/tours/availability?apiKey=test-key'
    ) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    await expect(response.json()).resolves.toEqual({
      error: 'Too many requests. Please try again later.',
    })
  })

  it('returns a fallback response when calendar is not connected', async () => {
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      property_id: 'property-1',
                      tours_enabled: true,
                    },
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
    getCalendarConfigMock.mockResolvedValue(null)

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/tours/availability?apiKey=test-key'
    ) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(503)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toMatchObject({
      error: 'Google Calendar not connected',
      fallback: true,
    })
  })

  it('returns grouped availability for a connected calendar', async () => {
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      property_id: 'property-1',
                      tours_enabled: true,
                    },
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
    fetchBusyTimesMock.mockResolvedValue([])
    generateAvailableSlotsMock
      .mockReturnValueOnce([
        { time: '10:00', available: true },
        { time: '11:00', available: false },
      ])
      .mockReturnValueOnce([
        { time: '09:30', available: false },
      ])

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/tours/availability?apiKey=test-key&startDate=2026-03-16&endDate=2026-03-17',
      { headers: { origin: 'https://widget.example.com' } }
    ) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toEqual({
      success: true,
      availableDates: ['2026-03-16'],
      slotsByDate: {
        '2026-03-16': [
          { time: '10:00', available: true },
          { time: '11:00', available: false },
        ],
      },
      timezone: 'America/Chicago',
      tourDuration: 45,
      bufferMinutes: 15,
    })
  })

  it('returns 400 for an invalid date range', async () => {
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      property_id: 'property-1',
                      tours_enabled: true,
                    },
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
    getCalendarConfigMock.mockResolvedValue({
      token_status: 'healthy',
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/tours/availability?apiKey=test-key&startDate=bad-date'
    ) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid startDate or endDate',
    })
  })

  it('returns 400 when the date range is too large', async () => {
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      property_id: 'property-1',
                      tours_enabled: true,
                    },
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
    getCalendarConfigMock.mockResolvedValue({
      token_status: 'healthy',
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/tours/availability?apiKey=test-key&startDate=2026-03-01&endDate=2026-04-15'
    ) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Date range cannot exceed 31 days',
    })
  })
})
