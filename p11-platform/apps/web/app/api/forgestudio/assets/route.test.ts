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

describe('forgestudio assets route', () => {
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
      new Request('http://localhost/api/forgestudio/assets?propertyId=property-1') as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('POST returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/forgestudio/assets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          propertyId: 'property-1',
          name: 'Asset',
          assetType: 'image',
          fileUrl: 'https://example.com/a.png',
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('PATCH returns 403 when asset property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const updateSelectSingleMock = vi.fn()
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'content_assets') {
        throw new Error(`Unexpected table ${table}`)
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 'asset-1', property_id: 'property-1' },
              error: null,
            }),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: updateSelectSingleMock,
            })),
          })),
        })),
      }
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/forgestudio/assets', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetId: 'asset-1', name: 'Updated' }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(updateSelectSingleMock).not.toHaveBeenCalled()
  })

  it('DELETE returns 403 when asset property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const deleteEqMock = vi.fn()
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'content_assets') {
        throw new Error(`Unexpected table ${table}`)
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 'asset-1', property_id: 'property-1' },
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
      new Request('http://localhost/api/forgestudio/assets?assetId=asset-1') as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(deleteEqMock).not.toHaveBeenCalled()
  })
})
