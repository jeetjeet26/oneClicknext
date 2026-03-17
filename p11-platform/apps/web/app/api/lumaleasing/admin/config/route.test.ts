import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const adminLimiterCheckMock = vi.fn()
const getRateLimitKeyMock = vi.fn()
const rateLimitHeadersMock = vi.fn()
const validateBodyMock = vi.fn()
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

vi.mock('@/utils/services/rate-limiter', () => ({
  adminLimiter: {
    check: adminLimiterCheckMock,
  },
  getRateLimitKey: getRateLimitKeyMock,
  rateLimitHeaders: rateLimitHeadersMock,
}))

vi.mock('@/utils/services/validation', () => ({
  validateBody: validateBodyMock,
  adminConfigUpdateSchema: {},
}))

vi.mock('@/utils/services/audit-logger', () => ({
  auditLog: auditLogMock,
  getRequestIp: getRequestIpMock,
}))

describe('Luma admin config route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    getRateLimitKeyMock.mockReturnValue('admin-config-key')
    adminLimiterCheckMock.mockReturnValue({
      allowed: true,
      remaining: 59,
      resetAt: Date.now() + 60_000,
    })
    rateLimitHeadersMock.mockReturnValue({})
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId: 'org-1' })
    validateBodyMock.mockReturnValue({
      success: true,
      data: {
        propertyId: 'property-1',
        config: {
          widget_name: 'Luma',
          primary_color: '#6366f1',
          secondary_color: '#8b5cf6',
          tours_enabled: true,
          tour_duration_minutes: 30,
          tour_buffer_minutes: 15,
          business_hours: {
            monday: { start: '09:00', end: '17:00' },
            tuesday: null,
          },
          timezone: 'America/Chicago',
          is_active: true,
        },
      },
    })
    auditLogMock.mockImplementation(() => {})
    getRequestIpMock.mockReturnValue('127.0.0.1')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated on GET', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/admin/config?propertyId=property-1',
      { method: 'GET' }
    ) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('creates and returns a default config when one does not exist', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })

    const configSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({
        data: {
          id: 'config-1',
          property_id: 'property-1',
          api_key: 'luma_generated',
        },
        error: null,
      })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: configSingle,
              })),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: configSingle,
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/admin/config?propertyId=property-1',
      { method: 'GET' }
    ) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toEqual({
      config: {
        id: 'config-1',
        property_id: 'property-1',
        api_key: 'luma_generated',
      },
    })
    expect(auditLogMock).toHaveBeenCalled()
  })

  it('updates config on PUT', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })

    const updateConfigEq = vi.fn().mockResolvedValue({ error: null })
    const updateCalendarEqSyncEnabled = vi.fn().mockResolvedValue({ error: null })
    const updateCalendarEqProperty = vi.fn().mockReturnValue({
      eq: updateCalendarEqSyncEnabled,
    })
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            update: vi.fn(() => ({
              eq: updateConfigEq,
            })),
          }
        }

        if (table === 'agent_calendars') {
          return {
            update: vi.fn((payload: Record<string, unknown>) => {
              expect(payload).toMatchObject({
                tour_duration_minutes: 30,
                buffer_minutes: 15,
                timezone: 'America/Chicago',
              })
              return {
                eq: updateCalendarEqProperty,
              }
            }),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { PUT } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/admin/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        propertyId: 'property-1',
        config: {
          widget_name: 'Luma',
          primary_color: '#6366f1',
          secondary_color: '#8b5cf6',
          tours_enabled: true,
          tour_duration_minutes: 30,
          tour_buffer_minutes: 15,
          timezone: 'America/Chicago',
          business_hours: {
            monday: { start: '09:00', end: '17:00' },
            tuesday: null,
          },
          is_active: true,
        },
      }),
    }) as NextRequest

    const response = await PUT(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toEqual({ success: true })
    expect(updateConfigEq).toHaveBeenCalledWith('property_id', 'property-1')
    expect(updateCalendarEqProperty).toHaveBeenCalledWith('property_id', 'property-1')
    expect(updateCalendarEqSyncEnabled).toHaveBeenCalledWith('sync_enabled', true)
  })
})
