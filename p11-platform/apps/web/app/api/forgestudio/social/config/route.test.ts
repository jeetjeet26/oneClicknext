import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const PROPERTY_ID = '33333333-3333-4333-8333-333333333333'

const authGetUserMock = vi.fn()
const createServerClientMock = vi.fn()
const validatePropertyManagerAccessMock = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createServerClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyManagerAccess: validatePropertyManagerAccessMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

describe('forgestudio social config route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    createServerClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { GET } = await import('./route')
    const response = await GET(
      new Request(
        `http://localhost/api/forgestudio/social/config?propertyId=${PROPERTY_ID}`
      ) as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('POST returns 403 when the user is not a manager or admin', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyManagerAccessMock.mockResolvedValue({
      authorized: false,
      error: 'Requires admin or manager role',
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/forgestudio/social/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          propertyId: PROPERTY_ID,
          platform: 'meta',
          appId: 'app-id',
          appSecret: 'app-secret',
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Requires admin or manager role',
    })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('POST returns 400 for invalid payloads', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/forgestudio/social/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          propertyId: 'not-a-uuid',
          platform: 'myspace',
          appId: '',
          appSecret: '',
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid request' })
    expect(validatePropertyManagerAccessMock).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('DELETE returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyManagerAccessMock.mockResolvedValue({ authorized: false })

    const { DELETE } = await import('./route')
    const response = await DELETE(
      new Request(
        `http://localhost/api/forgestudio/social/config?propertyId=${PROPERTY_ID}&platform=meta`
      ) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
