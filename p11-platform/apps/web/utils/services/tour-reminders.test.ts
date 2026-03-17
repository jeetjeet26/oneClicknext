import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createServiceClientMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

describe('tour reminders service', () => {
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

  it('counts pending 24h and 1h reminders across tours and tour bookings', async () => {
    const formatLocalDate = (date: Date) =>
      `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date
        .getDate()
        .toString()
        .padStart(2, '0')}`
    const formatLocalTime = (date: Date) =>
      `${date.getHours().toString().padStart(2, '0')}:${date
        .getMinutes()
        .toString()
        .padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`

    const now = new Date()
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const oneHour = new Date(now.getTime() + 60 * 60 * 1000)

    const tomorrowDate = formatLocalDate(tomorrow)
    const tomorrowTime = formatLocalTime(tomorrow)
    const oneHourDate = formatLocalDate(oneHour)
    const oneHourTime = formatLocalTime(oneHour)

    const toursEqProperty = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'tour-1',
          tour_date: tomorrowDate,
          tour_time: tomorrowTime,
          reminder_24h_sent_at: null,
          reminder_sent_at: null,
        },
      ],
      error: null,
    })
    const bookingsEqProperty = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'booking-1',
          scheduled_date: oneHourDate,
          scheduled_time: oneHourTime,
          reminder_24h_sent_at: null,
          reminder_1h_sent_at: null,
        },
      ],
      error: null,
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'tours') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                or: vi.fn(() => ({
                  eq: toursEqProperty,
                  then: undefined,
                })),
              })),
            })),
          }
        }

        if (table === 'tour_bookings') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                or: vi.fn(() => ({
                  eq: bookingsEqProperty,
                  then: undefined,
                })),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { getPendingRemindersCount } = await import('./tour-reminders')
    const result = await getPendingRemindersCount('property-1')

    expect(result).toEqual({
      reminders24h: 1,
      reminders1h: 1,
    })
    expect(toursEqProperty).toHaveBeenCalledWith('property_id', 'property-1')
    expect(bookingsEqProperty).toHaveBeenCalledWith('property_id', 'property-1')
  })
})
