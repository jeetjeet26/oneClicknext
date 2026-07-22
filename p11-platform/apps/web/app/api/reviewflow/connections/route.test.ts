import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const fromMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

describe('reviewflow connections route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReset()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })
  })

  it('returns 401 for GET when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/reviewflow/connections?propertyId=property-1') as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 for POST when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/reviewflow/connections', {
        method: 'POST',
        body: JSON.stringify({ propertyId: 'property-1', platform: 'google', placeId: 'abc' }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns 403 for PATCH when connection property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const singleMock = vi.fn().mockResolvedValue({
      data: { id: 'conn-1', property_id: 'property-1' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/reviewflow/connections', {
        method: 'PATCH',
        body: JSON.stringify({ connectionId: 'conn-1', isActive: false }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns 403 for DELETE when connection property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const singleMock = vi.fn().mockResolvedValue({
      data: { id: 'conn-1', property_id: 'property-1' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { DELETE } = await import('./route')
    const response = await DELETE(
      new Request('http://localhost/api/reviewflow/connections?connectionId=conn-1') as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns 403 for POST when the profile lacks a manager role', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    // loadProfileRole reads profiles.role via the session client.
    const profileSingle = vi.fn().mockResolvedValue({ data: { role: 'member' }, error: null })
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle })
    const profileSelect = vi.fn().mockReturnValue({ eq: profileEq })
    fromMock.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileSelect }
      throw new Error(`Unexpected table ${table}`)
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/reviewflow/connections', {
        method: 'POST',
        body: JSON.stringify({ propertyId: 'property-1', platform: 'google', placeId: 'abc' }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Manager or admin role is required to manage connections',
    })
  })

  it('returns 400 for POST with an unsupported platform', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const profileSingle = vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null })
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle })
    const profileSelect = vi.fn().mockReturnValue({ eq: profileEq })
    fromMock.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileSelect }
      throw new Error(`Unexpected table ${table}`)
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/reviewflow/connections', {
        method: 'POST',
        body: JSON.stringify({ propertyId: 'property-1', platform: 'facebook', placeId: 'abc' }),
      }) as NextRequest
    )

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error).toContain("Platform 'facebook' is not supported")
  })

  it('redacts credential fields from GET responses', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const connectionRow = {
      id: 'conn-1',
      property_id: 'property-1',
      platform: 'google',
      place_id: 'place-1',
      google_maps_url: null,
      yelp_business_id: null,
      yelp_business_url: null,
      account_id: null,
      is_active: true,
      api_key: 'super-secret-key',
      access_token: 'oauth-token',
      refresh_token: 'refresh-token',
    }
    const orderMock = vi.fn().mockResolvedValue({ data: [connectionRow], error: null })
    const eqMock = vi.fn().mockReturnValue({ order: orderMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/reviewflow/connections?propertyId=property-1') as NextRequest
    )

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.connections).toHaveLength(1)
    const connection = json.connections[0]
    expect(connection.api_key).toBeUndefined()
    expect(connection.access_token).toBeUndefined()
    expect(connection.refresh_token).toBeUndefined()
    // Capability honesty is exposed instead of raw credentials.
    expect(connection.capabilities).toBeDefined()
    expect(JSON.stringify(json)).not.toContain('super-secret-key')
    expect(JSON.stringify(json)).not.toContain('oauth-token')
  })
})
