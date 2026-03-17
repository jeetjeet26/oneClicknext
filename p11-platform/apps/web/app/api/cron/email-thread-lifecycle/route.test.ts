import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createServiceClientMock = vi.fn()
const startCronJobRunMock = vi.fn()
const finishCronJobRunMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/cron-job-runs', () => ({
  startCronJobRun: startCronJobRunMock,
  finishCronJobRun: finishCronJobRunMock,
}))

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as NextRequest
}

describe('cron email thread lifecycle route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    startCronJobRunMock.mockResolvedValue({
      id: 'run-1',
      jobName: 'email-thread-lifecycle',
      startedAtMs: 1,
    })
    finishCronJobRunMock.mockResolvedValue(undefined)
  })

  it('returns 401 when cron secret is invalid', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')

    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/cron/email-thread-lifecycle'))

    expect(response.status).toBe(401)
  })

  it('auto-resolves stale awaiting_lead_reply threads and logs lead activity', async () => {
    const resolvedThreadsSelectMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'thread-1',
          lead_id: 'lead-1',
          property_id: 'property-1',
          last_message_at: '2026-03-01T10:00:00.000Z',
        },
      ],
      error: null,
    })
    const resolvedThreadsLteMock = vi.fn().mockReturnValue({ select: resolvedThreadsSelectMock })
    const resolvedThreadsEqMock = vi.fn().mockReturnValue({ lte: resolvedThreadsLteMock })
    const overdueThreadsLimitMock = vi.fn().mockResolvedValue({ data: [], error: null })
    const overdueThreadsLteMock = vi.fn().mockReturnValue({ limit: overdueThreadsLimitMock })
    const overdueThreadsEqMock = vi.fn().mockReturnValue({ lte: overdueThreadsLteMock })
    const threadUpdateMock = vi.fn().mockReturnValue({ eq: resolvedThreadsEqMock })
    const leadActivitiesInsertMock = vi.fn().mockResolvedValue({ error: null })
    const leadActivitiesSelectLimitMock = vi.fn().mockResolvedValue({ data: [], error: null })
    const leadActivitiesSelectEqMock = vi.fn().mockReturnValue({ limit: leadActivitiesSelectLimitMock })
    const leadActivitiesSelectInMock = vi.fn().mockReturnValue({ eq: leadActivitiesSelectEqMock })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_threads') {
          return {
            update: threadUpdateMock,
            select: vi.fn().mockReturnValue({ eq: overdueThreadsEqMock }),
          }
        }
        if (table === 'lead_activities') {
          return {
            insert: leadActivitiesInsertMock,
            select: vi.fn().mockReturnValue({ in: leadActivitiesSelectInMock }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/cron/email-thread-lifecycle', {
        headers: { authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      staleDays: 7,
      resolved: 1,
      activityCount: 1,
      overdueInternalReply: 0,
      escalationActivityCount: 0,
    })
    expect(threadUpdateMock).toHaveBeenCalledWith({ status: 'resolved' })
    expect(resolvedThreadsEqMock).toHaveBeenCalledWith('status', 'awaiting_lead_reply')
    expect(leadActivitiesInsertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          lead_id: 'lead-1',
          type: 'email_thread_auto_resolved',
        }),
      ])
    )
  })

  it('supports staleDays override and skips activity when no lead mapping exists', async () => {
    const resolvedThreadsSelectMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'thread-2',
          lead_id: null,
          property_id: 'property-1',
          last_message_at: '2026-03-01T10:00:00.000Z',
        },
      ],
      error: null,
    })
    const resolvedThreadsLteMock = vi.fn().mockReturnValue({ select: resolvedThreadsSelectMock })
    const resolvedThreadsEqMock = vi.fn().mockReturnValue({ lte: resolvedThreadsLteMock })
    const overdueThreadsLimitMock = vi.fn().mockResolvedValue({ data: [], error: null })
    const overdueThreadsLteMock = vi.fn().mockReturnValue({ limit: overdueThreadsLimitMock })
    const overdueThreadsEqMock = vi.fn().mockReturnValue({ lte: overdueThreadsLteMock })
    const threadUpdateMock = vi.fn().mockReturnValue({ eq: resolvedThreadsEqMock })
    const leadActivitiesInsertMock = vi.fn()
    const leadActivitiesSelectLimitMock = vi.fn().mockResolvedValue({ data: [], error: null })
    const leadActivitiesSelectEqMock = vi.fn().mockReturnValue({ limit: leadActivitiesSelectLimitMock })
    const leadActivitiesSelectInMock = vi.fn().mockReturnValue({ eq: leadActivitiesSelectEqMock })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_threads') {
          return {
            update: threadUpdateMock,
            select: vi.fn().mockReturnValue({ eq: overdueThreadsEqMock }),
          }
        }
        if (table === 'lead_activities') {
          return {
            insert: leadActivitiesInsertMock,
            select: vi.fn().mockReturnValue({ in: leadActivitiesSelectInMock }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/cron/email-thread-lifecycle?staleDays=14', {
        headers: { authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      staleDays: 14,
      resolved: 1,
      activityCount: 0,
      overdueInternalReply: 0,
      escalationActivityCount: 0,
    })
    expect(leadActivitiesInsertMock).not.toHaveBeenCalled()
  })

  it('logs overdue awaiting_internal_reply threads once', async () => {
    const resolvedThreadsSelectMock = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    })
    const overdueThreadsLimitMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'thread-overdue-1',
          lead_id: 'lead-2',
          property_id: 'property-1',
          last_message_at: '2026-03-01T10:00:00.000Z',
        },
      ],
      error: null,
    })
    const overdueThreadsLteMock = vi.fn().mockReturnValue({ limit: overdueThreadsLimitMock })
    const overdueThreadsEqMock = vi.fn().mockReturnValue({ lte: overdueThreadsLteMock })
    const threadUpdateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ lte: vi.fn().mockReturnValue({ select: resolvedThreadsSelectMock }) }),
    })
    const leadActivitiesInsertMock = vi.fn().mockResolvedValue({ error: null })
    const leadActivitiesSelectLimitMock = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    })
    const leadActivitiesSelectEqMock = vi.fn().mockReturnValue({ limit: leadActivitiesSelectLimitMock })
    const leadActivitiesSelectInMock = vi.fn().mockReturnValue({ eq: leadActivitiesSelectEqMock })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_threads') {
          return {
            update: threadUpdateMock,
            select: vi.fn().mockReturnValue({ eq: overdueThreadsEqMock }),
          }
        }
        if (table === 'lead_activities') {
          return {
            insert: leadActivitiesInsertMock,
            select: vi.fn().mockReturnValue({ in: leadActivitiesSelectInMock }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/cron/email-thread-lifecycle', {
        headers: { authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      resolved: 0,
      overdueInternalReply: 1,
      escalationActivityCount: 1,
    })
    expect(leadActivitiesInsertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          lead_id: 'lead-2',
          type: 'email_thread_internal_reply_overdue',
        }),
      ])
    )
  })

  it('skips duplicate overdue escalation activities for the same thread snapshot', async () => {
    const resolvedThreadsSelectMock = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    })
    const overdueThreadsLimitMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'thread-overdue-2',
          lead_id: 'lead-3',
          property_id: 'property-1',
          last_message_at: '2026-03-01T10:00:00.000Z',
        },
      ],
      error: null,
    })
    const overdueThreadsLteMock = vi.fn().mockReturnValue({ limit: overdueThreadsLimitMock })
    const overdueThreadsEqMock = vi.fn().mockReturnValue({ lte: overdueThreadsLteMock })
    const threadUpdateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ lte: vi.fn().mockReturnValue({ select: resolvedThreadsSelectMock }) }),
    })
    const leadActivitiesInsertMock = vi.fn().mockResolvedValue({ error: null })
    const leadActivitiesSelectLimitMock = vi.fn().mockResolvedValue({
      data: [
        {
          metadata: {
            email_thread_id: 'thread-overdue-2',
            last_message_at: '2026-03-01T10:00:00.000Z',
          },
        },
      ],
      error: null,
    })
    const leadActivitiesSelectEqMock = vi.fn().mockReturnValue({ limit: leadActivitiesSelectLimitMock })
    const leadActivitiesSelectInMock = vi.fn().mockReturnValue({ eq: leadActivitiesSelectEqMock })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_threads') {
          return {
            update: threadUpdateMock,
            select: vi.fn().mockReturnValue({ eq: overdueThreadsEqMock }),
          }
        }
        if (table === 'lead_activities') {
          return {
            insert: leadActivitiesInsertMock,
            select: vi.fn().mockReturnValue({ in: leadActivitiesSelectInMock }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/cron/email-thread-lifecycle', {
        headers: { authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      resolved: 0,
      overdueInternalReply: 1,
      escalationActivityCount: 0,
    })
    expect(leadActivitiesInsertMock).not.toHaveBeenCalled()
  })
})
