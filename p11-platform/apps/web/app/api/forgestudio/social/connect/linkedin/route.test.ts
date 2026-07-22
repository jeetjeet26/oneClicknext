import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createServerClientMock = vi.fn()
const validatePropertyManagerAccessMock = vi.fn()
const getLinkedInCredentialsMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createServerClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyManagerAccess: validatePropertyManagerAccessMock,
}))

vi.mock('@/utils/forgestudio/social-config', () => ({
  getLinkedInCredentials: getLinkedInCredentialsMock,
}))

describe('forgestudio social connect linkedin route', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env = { ...originalEnv, NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' }
    createServerClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('redirects with unauthorized error when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { GET } = await import('./route')
    const response = await GET(
      new Request(
        'http://localhost/api/forgestudio/social/connect/linkedin?propertyId=property-1'
      ) as NextRequest
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=Unauthorized')
    expect(getLinkedInCredentialsMock).not.toHaveBeenCalled()
  })

  it('redirects with forbidden error when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyManagerAccessMock.mockResolvedValue({ authorized: false })

    const { GET } = await import('./route')
    const response = await GET(
      new Request(
        'http://localhost/api/forgestudio/social/connect/linkedin?propertyId=property-1'
      ) as NextRequest
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=Forbidden')
    expect(getLinkedInCredentialsMock).not.toHaveBeenCalled()
  })
})
