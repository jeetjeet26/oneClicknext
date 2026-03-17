import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createServiceClientMock = vi.fn()
const startCronJobRunMock = vi.fn()
const finishCronJobRunMock = vi.fn()
const ingestExternalCalendarMutationsForPropertyMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/cron-job-runs', () => ({
  startCronJobRun: startCronJobRunMock,
  finishCronJobRun: finishCronJobRunMock,
}))

vi.mock('@/utils/services/lumaleasing-calendar-mutations', () => ({
  CalendarMutationIngestError: class CalendarMutationIngestError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  },
  ingestExternalCalendarMutationsForProperty: ingestExternalCalendarMutationsForPropertyMock,
}))

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as NextRequest
}

describe('cron calendar ingest route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    startCronJobRunMock.mockResolvedValue({
      id: 'run-1',
      jobName: 'lumaleasing-calendar-ingest',
      startedAtMs: 1,
    })
    finishCronJobRunMock.mockResolvedValue(undefined)
  })

  it('returns 401 when cron secret is invalid', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')

    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/cron/calendar-ingest'))

    expect(response.status).toBe(401)
  })

  it('ingests external calendar mutations for healthy configs', async () => {
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
                    { property_id: 'property-1', google_email: 'one@example.com' },
                    { property_id: 'property-2', google_email: 'two@example.com' },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }
      }),
    })
    ingestExternalCalendarMutationsForPropertyMock
      .mockResolvedValueOnce({
        propertyId: 'property-1',
        checked: 2,
        healthy: 1,
        drifted: 1,
        missing: 0,
        cancelled: 0,
      })
      .mockResolvedValueOnce({
        propertyId: 'property-2',
        checked: 1,
        healthy: 1,
        drifted: 0,
        missing: 0,
        cancelled: 0,
      })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/cron/calendar-ingest', {
        headers: { authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      processed: 2,
      successful: 2,
      failed: 0,
      checked: 3,
      drifted: 1,
      missing: 0,
      cancelled: 0,
    })
    expect(ingestExternalCalendarMutationsForPropertyMock).toHaveBeenCalledWith('property-1')
    expect(ingestExternalCalendarMutationsForPropertyMock).toHaveBeenCalledWith('property-2')
  })
})
