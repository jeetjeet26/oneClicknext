import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const processTourNoShowsMock = vi.fn()
const getNoShowStatsMock = vi.fn()
const startCronJobRunMock = vi.fn()
const finishCronJobRunMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/tour-noshow', () => ({
  processTourNoShows: processTourNoShowsMock,
  getNoShowStats: getNoShowStatsMock,
}))

vi.mock('@/utils/services/cron-job-runs', () => ({
  startCronJobRun: startCronJobRunMock,
  finishCronJobRun: finishCronJobRunMock,
}))

describe('tour no-show route', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env = { ...originalEnv }
    startCronJobRunMock.mockResolvedValue({
      id: 'run-1',
      jobName: 'tours-noshow',
      startedAtMs: 0,
    })
    finishCronJobRunMock.mockResolvedValue(undefined)
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('returns 401 when cron auth is invalid for POST', async () => {
    process.env.CRON_SECRET = 'expected-secret'

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/tours/noshow', {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-secret',
      },
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns processing results for a valid cron POST', async () => {
    process.env.CRON_SECRET = 'expected-secret'
    processTourNoShowsMock.mockResolvedValue({
      processed: 3,
      markedNoShow: 2,
      followupsSent: 2,
      failed: 0,
      errors: [],
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/tours/noshow', {
      method: 'POST',
      headers: {
        authorization: 'Bearer expected-secret',
      },
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toMatchObject({
      success: true,
      processed: 3,
      markedNoShow: 2,
      followupsSent: 2,
      failed: 0,
      errors: [],
    })
  })

  it('returns 403 when property access is denied on GET', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/tours/noshow?propertyId=property-1',
      { method: 'GET' }
    ) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(403)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns no-show stats for an authorized property', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    getNoShowStatsMock.mockResolvedValue({
      totalNoShows: 5,
      followupsSent: 3,
      rescheduled: 1,
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/tours/noshow?propertyId=property-1',
      { method: 'GET' }
    ) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toEqual({
      success: true,
      stats: {
        totalNoShows: 5,
        followupsSent: 3,
        rescheduled: 1,
      },
      timestamp: expect.any(String),
    })
  })
})
