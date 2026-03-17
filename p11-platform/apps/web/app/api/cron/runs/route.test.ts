import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const listRecentCronJobRunsMock = vi.fn()
const profileSingleMock = vi.fn()
const profileEqMock = vi.fn()
const profileSelectMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/cron-job-runs', () => ({
  listRecentCronJobRuns: listRecentCronJobRunsMock,
}))

describe('GET /api/cron/runs', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    profileSingleMock.mockResolvedValue({
      data: { role: 'admin' },
      error: null,
    })
    profileEqMock.mockReturnValue({ single: profileSingleMock })
    profileSelectMock.mockReturnValue({ eq: profileEqMock })
    fromMock.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: profileSelectMock }
      }
      throw new Error(`Unexpected table requested in test: ${table}`)
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/runs', {
      method: 'GET',
    }) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 400 when limit is invalid', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/runs?limit=101', {
      method: 'GET',
    }) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(400)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({
      error: 'limit must be an integer between 1 and 100',
    })
  })

  it('returns 403 when authenticated user is not admin or manager', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    profileSingleMock.mockResolvedValue({
      data: { role: 'member' },
      error: null,
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/runs', {
      method: 'GET',
    }) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(403)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(listRecentCronJobRunsMock).not.toHaveBeenCalled()
  })

  it('returns recent cron job runs for an authenticated user', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    listRecentCronJobRunsMock.mockResolvedValue([
      {
        id: 'run-1',
        job_name: 'gmail-sync',
        status: 'success',
        trigger_source: 'cron',
        request_id: 'req-1',
        started_at: '2026-03-13T01:00:00.000Z',
        completed_at: '2026-03-13T01:00:10.000Z',
        duration_ms: 10000,
        summary: { processed: 1 },
        error: null,
        created_at: '2026-03-13T01:00:00.000Z',
      },
    ])

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/cron/runs?limit=5&jobName=gmail-sync&status=success',
      { method: 'GET' }
    ) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(fromMock).toHaveBeenCalledWith('profiles')
    expect(listRecentCronJobRunsMock).toHaveBeenCalledWith({
      limit: 5,
      jobName: 'gmail-sync',
      status: 'success',
    })
    expect(json).toEqual({
      success: true,
      runs: [
        {
          id: 'run-1',
          job_name: 'gmail-sync',
          status: 'success',
          trigger_source: 'cron',
          request_id: 'req-1',
          started_at: '2026-03-13T01:00:00.000Z',
          completed_at: '2026-03-13T01:00:10.000Z',
          duration_ms: 10000,
          summary: { processed: 1 },
          error: null,
          created_at: '2026-03-13T01:00:00.000Z',
        },
      ],
    })
  })
})
