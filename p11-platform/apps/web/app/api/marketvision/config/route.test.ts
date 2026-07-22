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

describe('marketvision config route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/marketvision/config?propertyId=property-1'),
    )
    expect(response.status).toBe(401)
  })

  it('GET returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })
    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/marketvision/config?propertyId=property-1'),
    )
    expect(response.status).toBe(403)
  })

  it('GET returns the property config', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { property_id: 'property-1', scrape_frequency: 'daily' } })
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ maybeSingle }),
      }),
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/marketvision/config?propertyId=property-1'),
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.config.scrape_frequency).toBe('daily')
  })

  it('PUT rejects invalid scrapeFrequency', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const { PUT } = await import('./route')
    const response = await PUT(
      makeNextRequest('http://localhost/api/marketvision/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: 'property-1', scrapeFrequency: 'hourly' }),
      }),
    )
    expect(response.status).toBe(400)
  })

  it('PUT rejects out-of-range radiusMiles', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const { PUT } = await import('./route')
    const response = await PUT(
      makeNextRequest('http://localhost/api/marketvision/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: 'property-1', radiusMiles: 100 }),
      }),
    )
    expect(response.status).toBe(400)
  })

  it('PUT upserts config scoped to the property', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const upsertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { property_id: 'property-1', scrape_frequency: 'weekly' },
          error: null,
        }),
      }),
    })
    fromMock.mockReturnValue({ upsert: upsertMock })

    const { PUT } = await import('./route')
    const response = await PUT(
      makeNextRequest('http://localhost/api/marketvision/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: 'property-1',
          scrapeFrequency: 'weekly',
          radiusMiles: 5,
          maxCompetitors: 30,
          autoAdd: false,
          isEnabled: true,
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        property_id: 'property-1',
        scrape_frequency: 'weekly',
        radius_miles: 5,
        max_competitors: 30,
        auto_add: false,
        is_enabled: true,
      }),
      { onConflict: 'property_id' },
    )
    const json = await response.json()
    expect(json.config.scrape_frequency).toBe('weekly')
  })

  it('PUT requires propertyId', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    const { PUT } = await import('./route')
    const response = await PUT(
      makeNextRequest('http://localhost/api/marketvision/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scrapeFrequency: 'daily' }),
      }),
    )
    expect(response.status).toBe(400)
  })
})
