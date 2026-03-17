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
        'http://localhost/api/forgestudio/social/connections?propertyId=property-1'
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
        'http://localhost/api/forgestudio/social/connections?propertyId=property-1'
      ) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('DELETE returns 403 when connection property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const deleteEqMock = vi.fn()
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'social_connections') {
        throw new Error(`Unexpected table ${table}`)
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 'conn-1', property_id: 'property-1' },
              error: null,
            }),
          })),
        })),
        delete: vi.fn(() => ({
          eq: deleteEqMock,
        })),
      }
    })

    const { DELETE } = await import('./route')
    const response = await DELETE(
      new Request(
        'http://localhost/api/forgestudio/social/connections?connectionId=conn-1'
      ) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(deleteEqMock).not.toHaveBeenCalled()
  })

  it('DELETE returns 404 when connection does not exist', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    mockFrom.mockImplementation((table: string) => {
      if (table !== 'social_connections') {
        throw new Error(`Unexpected table ${table}`)
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'not found' },
            }),
          })),
        })),
      }
    })

    const { DELETE } = await import('./route')
    const response = await DELETE(
      new Request(
        'http://localhost/api/forgestudio/social/connections?connectionId=missing'
      ) as NextRequest
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Connection not found' })
  })
})
