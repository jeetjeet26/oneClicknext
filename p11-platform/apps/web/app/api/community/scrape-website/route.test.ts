import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createAdminClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const adminFromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

describe('community scrape-website route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    createAdminClientMock.mockReturnValue({
      from: adminFromMock,
    })
  })

  it('POST returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/community/scrape-website', {
        method: 'POST',
        body: JSON.stringify({ propertyId: 'property-1', websiteUrl: 'https://example.com' }),
      }) as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('POST returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/community/scrape-website', {
        method: 'POST',
        body: JSON.stringify({ propertyId: 'property-1', websiteUrl: 'https://example.com' }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('POST updates properties.website_url (not community_profiles) after successful scrape', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const selectSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'property-1', name: 'P1', org_id: 'org-1' },
      error: null,
    })
    const updateIsMock = vi.fn().mockResolvedValue({ error: null })
    const updateEqMock = vi.fn().mockReturnValue({ is: updateIsMock })
    const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock })
    const selectEqMock = vi.fn().mockReturnValue({ single: selectSingleMock })

    adminFromMock.mockImplementation((table: string) => {
      if (table !== 'properties') throw new Error(`Unexpected table ${table}`)
      return {
        select: vi.fn().mockReturnValue({ eq: selectEqMock }),
        update: updateMock,
      }
    })

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        documentsCreated: 2,
        amenities: ['Pool'],
        propertyName: 'P1',
        pagesScraped: 1,
      }),
      status: 200,
    } as unknown as Response)

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/community/scrape-website', {
        method: 'POST',
        body: JSON.stringify({ propertyId: 'property-1', websiteUrl: 'https://example.com' }),
      }) as NextRequest
    )

    expect(response.status).toBe(200)
    expect(adminFromMock).toHaveBeenCalledWith('properties')
    expect(updateMock).toHaveBeenCalledWith({ website_url: 'https://example.com/' })
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      documentsCreated: 2,
    })
  })
})
