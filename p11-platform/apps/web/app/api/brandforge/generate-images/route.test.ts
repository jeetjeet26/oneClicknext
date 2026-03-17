import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createServerClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createServerClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://example.com/image.png' } })),
      })),
    },
  })),
}))

describe('brandforge generate-images route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createServerClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/brandforge/generate-images', {
        method: 'POST',
        body: JSON.stringify({
          brandAssetId: 'brand-1',
          propertyId: 'property-1',
          type: 'logo',
          brandData: {},
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/brandforge/generate-images', {
        method: 'POST',
        body: JSON.stringify({
          brandAssetId: 'brand-1',
          propertyId: 'property-1',
          type: 'logo',
          brandData: {},
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })
})
