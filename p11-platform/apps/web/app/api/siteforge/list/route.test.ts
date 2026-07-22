import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
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

describe('siteforge list route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReset()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/siteforge/list?propertyId=property-1'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('GET returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const singleMock = vi.fn().mockResolvedValue({
      data: { org_id: 'org-1', name: 'Property' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/siteforge/list?propertyId=property-1'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('GET never exposes wp_credentials in the response payload', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const propertySingleMock = vi.fn().mockResolvedValue({
      data: { org_id: 'org-1', name: 'Property' },
      error: null,
    })
    const propertyEqMock = vi.fn().mockReturnValue({ single: propertySingleMock })
    const propertySelectMock = vi.fn().mockReturnValue({ eq: propertyEqMock })

    const websitesOrderMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'website-1',
          property_id: 'property-1',
          wp_url: 'https://example.com',
          wp_credentials: { username: 'admin', password: 'super-secret' },
          generation_status: 'complete',
          version: 1,
        },
      ],
      error: null,
    })
    const websitesEqMock = vi.fn().mockReturnValue({ order: websitesOrderMock })
    const websitesSelectMock = vi.fn().mockReturnValue({ eq: websitesEqMock })

    fromMock.mockImplementation((table: string) =>
      table === 'properties'
        ? { select: propertySelectMock }
        : { select: websitesSelectMock }
    )

    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/siteforge/list?propertyId=property-1'))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain('super-secret')
    expect(body.websites[0].wpCredentials).toBeUndefined()
    expect(body.websites[0].wpUrl).toBe('https://example.com')
  })
})
