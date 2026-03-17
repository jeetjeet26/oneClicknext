import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const validateBodyMock = vi.fn()
const getRateLimitKeyMock = vi.fn()
const adminLimiterCheckMock = vi.fn()
const rateLimitHeadersMock = vi.fn()
const trackEngagementEventMock = vi.fn()
const startWorkflowMock = vi.fn()
const auditLogMock = vi.fn()
const getRequestIpMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/validation', () => ({
  validateBody: validateBodyMock,
  tourCompleteSchema: {},
}))

vi.mock('@/utils/services/rate-limiter', () => ({
  adminLimiter: {
    check: adminLimiterCheckMock,
  },
  getRateLimitKey: getRateLimitKeyMock,
  rateLimitHeaders: rateLimitHeadersMock,
}))

vi.mock('@/utils/services/engagement-tracker', () => ({
  trackEngagementEvent: trackEngagementEventMock,
}))

vi.mock('@/utils/services/workflow-processor', () => ({
  startWorkflow: startWorkflowMock,
}))

vi.mock('@/utils/services/audit-logger', () => ({
  auditLog: auditLogMock,
  getRequestIp: getRequestIpMock,
}))

function makeEqChainSingle(result: unknown) {
  const single = vi.fn().mockResolvedValue(result)
  const secondEq = vi.fn(() => ({ single }))
  const firstEq = vi.fn(() => ({ eq: secondEq, single }))
  return { eq: firstEq, single }
}

describe('POST /api/tours/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    createClientMock.mockResolvedValue({
      auth: {
        getUser: authGetUserMock,
      },
    })

    getRateLimitKeyMock.mockReturnValue('tour-complete-key')
    adminLimiterCheckMock.mockReturnValue({ allowed: true })
    rateLimitHeadersMock.mockReturnValue({})
    getRequestIpMock.mockReturnValue('127.0.0.1')
    trackEngagementEventMock.mockReturnValue(Promise.resolve())
    startWorkflowMock.mockReturnValue(Promise.resolve())
    auditLogMock.mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthorized', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: new Error('unauthorized'),
    })

    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/tours/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tourId: 'tour-1' }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 400 when the tour is already completed', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validateBodyMock.mockReturnValue({
      success: true,
      data: { tourId: 'tour-1', notes: 'done' },
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId: 'org-1' })

    const tourBookingsChain = makeEqChainSingle({
      data: {
        id: 'tour-1',
        lead_id: 'lead-1',
        property_id: 'property-1',
        status: 'completed',
        scheduled_date: '2026-03-12',
        scheduled_time: '10:00:00',
      },
      error: null,
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'tour_bookings') return { select: vi.fn(() => tourBookingsChain) }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/tours/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tourId: 'tour-1', notes: 'done' }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Tour already completed' })
  })

  it('completes a tour and triggers side effects', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validateBodyMock.mockReturnValue({
      success: true,
      data: { tourId: 'tour-1', notes: 'great tour' },
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId: 'org-1' })

    const singleTourResult = {
      data: {
        id: 'tour-1',
        lead_id: 'lead-1',
        property_id: 'property-1',
        status: 'confirmed',
        scheduled_date: '2026-03-12',
        scheduled_time: '10:00:00',
      },
      error: null,
    }

    const serviceClient = {
      from: vi.fn((table: string) => {
        if (table === 'tour_bookings') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue(singleTourResult),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        }

        if (table === 'leads') {
          return {
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        }

        if (table === 'lead_activities') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    }

    createServiceClientMock.mockReturnValue(serviceClient)

    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/tours/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tourId: 'tour-1', notes: 'great tour' }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toMatchObject({
      success: true,
      tour: {
        id: 'tour-1',
        status: 'completed',
      },
    })
    expect(trackEngagementEventMock).toHaveBeenCalledWith({
      leadId: 'lead-1',
      propertyId: 'property-1',
      eventType: 'tour_completed',
      metadata: { tour_id: 'tour-1' },
    })
    expect(startWorkflowMock).toHaveBeenCalledWith(
      'lead-1',
      'property-1',
      'tour_completed'
    )
  })
})
