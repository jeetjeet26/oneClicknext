import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createServiceClientMock = vi.fn()
const startCronJobRunMock = vi.fn()
const finishCronJobRunMock = vi.fn()
const ensureCalendarWatchMock = vi.fn()
const shouldRenewCalendarWatchMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/cron-job-runs', () => ({
  startCronJobRun: startCronJobRunMock,
  finishCronJobRun: finishCronJobRunMock,
}))

vi.mock('@/utils/services/google-calendar', () => ({
  ensureCalendarWatch: ensureCalendarWatchMock,
  shouldRenewCalendarWatch: shouldRenewCalendarWatchMock,
}))

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as NextRequest
}

describe('cron calendar watch renew route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    startCronJobRunMock.mockResolvedValue({
      id: 'run-1',
      jobName: 'calendar-watch-renew',
      startedAtMs: 1,
    })
    finishCronJobRunMock.mockResolvedValue(undefined)
  })

  it('returns 401 when cron secret is invalid', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')

    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/cron/calendar-watch-renew'))

    expect(response.status).toBe(401)
  })

  it('renews watches for healthy calendar configs', async () => {
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'agent_calendars') {
          throw new Error(`Unexpected table ${table}`)
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'calendar-1',
                      property_id: 'property-1',
                      google_email: 'one@example.com',
                      calendar_id: 'primary',
                      access_token: 'access-token',
                      refresh_token: 'refresh-token',
                      token_expires_at: '2099-01-01T00:00:00.000Z',
                      working_hours: {},
                      tour_duration_minutes: 30,
                      buffer_minutes: 15,
                      timezone: 'America/Chicago',
                      token_status: 'healthy',
                      watch_channel_id: null,
                      watch_last_message_number: null,
                      watch_resource_id: null,
                      watch_expiration: null,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }
      }),
    })
    shouldRenewCalendarWatchMock.mockReturnValue(true)
    ensureCalendarWatchMock.mockResolvedValue({
      channelId: 'channel-1',
      resourceId: 'resource-1',
      expiration: '2099-01-02T00:00:00.000Z',
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/cron/calendar-watch-renew', {
        headers: { authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      processed: 1,
      successful: 1,
      skipped: 0,
      failed: 0,
      renewed: 1,
    })
    expect(ensureCalendarWatchMock).toHaveBeenCalledTimes(1)
  })

  it('marks configs as skipped when webhook URL is not configured', async () => {
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'agent_calendars') {
          throw new Error(`Unexpected table ${table}`)
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'calendar-1',
                      property_id: 'property-1',
                      google_email: 'one@example.com',
                      calendar_id: 'primary',
                      access_token: 'access-token',
                      refresh_token: 'refresh-token',
                      token_expires_at: '2099-01-01T00:00:00.000Z',
                      working_hours: {},
                      tour_duration_minutes: 30,
                      buffer_minutes: 15,
                      timezone: 'America/Chicago',
                      token_status: 'healthy',
                      watch_channel_id: 'channel-1',
                      watch_last_message_number: 10,
                      watch_resource_id: 'resource-1',
                      watch_expiration: '2099-01-02T00:00:00.000Z',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }
      }),
    })
    shouldRenewCalendarWatchMock.mockReturnValue(false)
    ensureCalendarWatchMock.mockResolvedValue(null)

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/cron/calendar-watch-renew', {
        headers: { authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      processed: 1,
      successful: 0,
      skipped: 1,
      failed: 0,
      renewed: 0,
    })
    expect(ensureCalendarWatchMock).toHaveBeenCalledTimes(1)
  })
})
