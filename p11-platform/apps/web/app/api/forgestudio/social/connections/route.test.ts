import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createServerClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createServerClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

describe('forgestudio social connections route', () => {
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
        'http://localhost/api/forgestudio/social/connections?propertyId=33333333-3333-4333-8333-333333333333'
      ) as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('GET returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { GET } = await import('./route')
    const response = await GET(
      new Request(
        'http://localhost/api/forgestudio/social/connections?propertyId=33333333-3333-4333-8333-333333333333'
      ) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('retires unversioned deletion before any account lookup',async()=>{authGetUserMock.mockResolvedValue({data:{user:{id:'user-1'}},error:null});const {DELETE}=await import('./route');expect((await DELETE(new Request('http://localhost/api/forgestudio/social/connections?connectionId=old') as NextRequest)).status).toBe(400);expect(mockFrom).not.toHaveBeenCalled()})
})
