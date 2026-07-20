import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  const request = new Request(url, init) as NextRequest
  Object.defineProperty(request, 'nextUrl', {
    value: new URL(url),
    configurable: true,
  })
  return request
}

describe('propertyaudit findings route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/findings?propertyId=property-1')
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('GET returns 400 when propertyId is missing', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/propertyaudit/findings'))

    expect(response.status).toBe(400)
  })

  it('GET returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false, error: 'Forbidden' })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/findings?propertyId=property-1')
    )

    expect(response.status).toBe(403)
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('PATCH rejects invalid status values', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      makeNextRequest('http://localhost/api/propertyaudit/findings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ findingId: 'finding-1', status: 'not-a-status' }),
      })
    )

    expect(response.status).toBe(400)
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('PATCH enforces tenant access via the finding property', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false, error: 'Forbidden' })

    const updateMock = vi.fn()
    createServiceClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 'finding-1', property_id: 'property-1', status: 'todo' },
              error: null,
            }),
          })),
        })),
        update: updateMock,
      })),
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      makeNextRequest('http://localhost/api/propertyaudit/findings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ findingId: 'finding-1', status: 'fixed' }),
      })
    )

    expect(response.status).toBe(403)
    expect(validatePropertyAccessMock).toHaveBeenCalledWith('user-1', 'property-1')
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('PATCH marks a finding fixed with fixed_at timestamp', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId: 'org-1' })

    let capturedUpdate: Record<string, unknown> = {}
    createServiceClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 'finding-1', property_id: 'property-1', status: 'todo' },
              error: null,
            }),
          })),
        })),
        update: vi.fn((payload: Record<string, unknown>) => {
          capturedUpdate = payload
          return {
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'finding-1', status: 'fixed' },
                  error: null,
                }),
              })),
            })),
          }
        }),
      })),
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      makeNextRequest('http://localhost/api/propertyaudit/findings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ findingId: 'finding-1', status: 'fixed' }),
      })
    )

    expect(response.status).toBe(200)
    expect(capturedUpdate).toMatchObject({ status: 'fixed' })
    expect(capturedUpdate.fixed_at).toBeTruthy()
  })
})
