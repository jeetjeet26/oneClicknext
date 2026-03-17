import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createServiceClientMock = vi.fn()
const startCronJobRunMock = vi.fn()
const finishCronJobRunMock = vi.fn()
const reconcileCalendarForPropertyMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/cron-job-runs', () => ({
  startCronJobRun: startCronJobRunMock,
  finishCronJobRun: finishCronJobRunMock,
}))

vi.mock('@/utils/services/lumaleasing-calendar-reconcile', () => ({
  CalendarReconcileError: class CalendarReconcileError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  },
  reconcileCalendarForProperty: reconcileCalendarForPropertyMock,
}))

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as NextRequest
}

describe('cron calendar reconcile route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    startCronJobRunMock.mockResolvedValue({ id: 'run-1', jobName: 'lumaleasing-calendar-reconcile', startedAtMs: 1 })
    finishCronJobRunMock.mockResolvedValue(undefined)
  })

  it('returns 401 when cron secret is invalid', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')

    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/cron/calendar-reconcile'))

    expect(response.status).toBe(401)
  })

  it('reconciles all healthy calendar configs and summarizes the run', async () => {
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
    reconcileCalendarForPropertyMock
      .mockResolvedValueOnce({
        propertyId: 'property-1',
        activeBookings: 2,
        created: 1,
        repaired: 1,
        alreadySynced: 0,
        skipped: 0,
        failed: 0,
        failures: [],
      })
      .mockResolvedValueOnce({
        propertyId: 'property-2',
        activeBookings: 1,
        created: 0,
        repaired: 0,
        alreadySynced: 1,
        skipped: 0,
        failed: 0,
        failures: [],
      })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/cron/calendar-reconcile', {
        headers: { authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      processed: 2,
      successful: 2,
      skipped: 0,
      failed: 0,
      created: 1,
      repaired: 1,
    })
    expect(reconcileCalendarForPropertyMock).toHaveBeenCalledWith('property-1')
    expect(reconcileCalendarForPropertyMock).toHaveBeenCalledWith('property-2')
    expect(finishCronJobRunMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'success',
        summary: expect.objectContaining({
          processed: 2,
          created: 1,
          repaired: 1,
        }),
      })
    )
  })

  it('supports targeted property reconciliation without fetching calendar configs', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    reconcileCalendarForPropertyMock.mockResolvedValue({
      propertyId: 'property-9',
      activeBookings: 3,
      created: 2,
      repaired: 1,
      alreadySynced: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/cron/calendar-reconcile?propertyId=property-9', {
        headers: { authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      processed: 1,
      created: 2,
      repaired: 1,
    })
    expect(createServiceClientMock).not.toHaveBeenCalled()
    expect(reconcileCalendarForPropertyMock).toHaveBeenCalledWith('property-9')
  })
})
