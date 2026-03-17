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

describe('forgestudio drafts route', () => {
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
      new Request('http://localhost/api/forgestudio/drafts?propertyId=property-1') as NextRequest
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
      new Request('http://localhost/api/forgestudio/drafts?propertyId=property-1') as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('PATCH returns 403 when draft property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const updateSelectSingleMock = vi.fn()
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'content_drafts') {
        throw new Error(`Unexpected table ${table}`)
      }

      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 'draft-1', property_id: 'property-1' },
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
      new Request('http://localhost/api/forgestudio/drafts', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draftId: 'draft-1', status: 'approved' }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(updateSelectSingleMock).not.toHaveBeenCalled()
  })

  it('DELETE returns 403 when draft property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const deleteEqMock = vi.fn()
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'content_drafts') {
        throw new Error(`Unexpected table ${table}`)
      }

      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 'draft-1', property_id: 'property-1' },
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
      new Request('http://localhost/api/forgestudio/drafts?draftId=draft-1') as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(deleteEqMock).not.toHaveBeenCalled()
  })

  it('PATCH returns 409 when approving a partial draft', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    mockFrom.mockImplementation((table: string) => {
      if (table !== 'content_drafts') {
        throw new Error(`Unexpected table ${table}`)
      }

      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'draft-1',
                property_id: 'property-1',
                status: 'draft_partial',
                caption: 'Great amenities this weekend',
                platform: 'instagram',
                content_type: 'social_post',
                media_type: 'image',
                media_urls: [],
                generation_params: null,
              },
              error: null,
            }),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(),
            })),
          })),
        })),
      }
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/forgestudio/drafts', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draftId: 'draft-1', status: 'approved' }),
      }) as NextRequest
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Draft is partial and not ready for approval/scheduling',
      blockers: expect.arrayContaining(['media_required_but_missing']),
    })
  })
})
