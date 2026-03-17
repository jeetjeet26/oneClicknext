import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const adminLimiterCheckMock = vi.fn()
const getRateLimitKeyMock = vi.fn()
const rateLimitHeadersMock = vi.fn()
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

vi.mock('@/utils/services/audit-logger', () => ({
  auditLog: auditLogMock,
  getRequestIp: getRequestIpMock,
}))

describe('Luma admin regenerate-key route', () => {
  const propertyId = '123e4567-e89b-12d3-a456-426614174000'

  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    getRateLimitKeyMock.mockReturnValue('regen-key')
    adminLimiterCheckMock.mockReturnValue({
      allowed: true,
      remaining: 59,
      resetAt: Date.now() + 60_000,
    })
    rateLimitHeadersMock.mockReturnValue({})
    auditLogMock.mockImplementation(() => {})
    getRequestIpMock.mockReturnValue('127.0.0.1')
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId: 'org-1' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/admin/regenerate-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 400 for an invalid request body', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/admin/regenerate-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'not-a-uuid' }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({
      error: 'propertyId: Invalid ID format',
    })
  })

  it('returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/admin/regenerate-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(403)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns 404 when no config row exists for the property', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/admin/regenerate-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(404)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'LumaLeasing config not found' })
  })

  it('rotates the api key for an authorized property', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { property_id: propertyId },
      error: null,
    })
    const select = vi.fn(() => ({
      maybeSingle,
    }))
    const eqFirst = vi.fn(() => ({
      select,
    }))

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            update: vi.fn(() => ({
              eq: eqFirst,
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/admin/regenerate-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json.apiKey).toMatch(/^[a-f0-9]{64}$/)
    expect(eqFirst).toHaveBeenCalledWith('property_id', propertyId)
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'api_key_regenerated',
        propertyId,
        userId: 'user-1',
      })
    )
  })
})
