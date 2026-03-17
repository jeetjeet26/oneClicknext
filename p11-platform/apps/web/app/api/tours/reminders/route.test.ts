import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const processTourRemindersMock = vi.fn()
const getPendingRemindersCountMock = vi.fn()
const startCronJobRunMock = vi.fn()
const finishCronJobRunMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/tour-reminders', () => ({
  processTourReminders: processTourRemindersMock,
  getPendingRemindersCount: getPendingRemindersCountMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/cron-job-runs', () => ({
  startCronJobRun: startCronJobRunMock,
  finishCronJobRun: finishCronJobRunMock,
}))

describe('Tours reminders route', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    startCronJobRunMock.mockResolvedValue({
      id: 'run-1',
      jobName: 'tours-reminders',
      startedAtMs: 0,
    })
    finishCronJobRunMock.mockResolvedValue(undefined)
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
    const request = new Request('http://localhost/api/tours/reminders', {
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

  it('returns reminder processing results for a valid cron request', async () => {
    process.env.CRON_SECRET = 'expected-secret'
    processTourRemindersMock.mockResolvedValue({
      processed: 5,
      reminders24h: 2,
      reminders1h: 1,
      failed: 0,
      errors: [],
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/tours/reminders', {
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
      processed: 5,
      reminders24h: 2,
      reminders1h: 1,
      failed: 0,
      errors: [],
    })
  })

  it('returns pending counts for an authenticated GET request', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
    })
    getPendingRemindersCountMock.mockResolvedValue({
      reminders24h: 3,
      reminders1h: 4,
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/tours/reminders?propertyId=property-1', {
      method: 'GET',
    }) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toEqual({
      success: true,
      pending: {
        reminders24h: 3,
        reminders1h: 4,
      },
      timestamp: expect.any(String),
    })
    expect(validatePropertyAccessMock).toHaveBeenCalledWith('user-1', 'property-1')
    expect(getPendingRemindersCountMock).toHaveBeenCalledWith('property-1')
  })

  it('returns 400 when an authenticated GET request omits propertyId', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/tours/reminders', {
      method: 'GET',
    }) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(400)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({
      error: 'Property ID is required',
    })
  })

  it('returns 403 when property access is denied on GET', async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/tours/reminders?propertyId=property-1', {
      method: 'GET',
    }) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(403)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })
})
