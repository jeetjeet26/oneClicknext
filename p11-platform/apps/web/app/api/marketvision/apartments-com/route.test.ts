import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/runtime-config', () => ({
  getDataEngineUrl: () => 'http://data-engine.test',
  getDataEngineHeaders: () => ({
    'Content-Type': 'application/json',
    'X-API-Key': 'engine-key',
  }),
}))

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  const request = new Request(url, init) as NextRequest
  Object.defineProperty(request, 'nextUrl', {
    value: new URL(url),
    configurable: true,
  })
  return request
}

describe('marketvision apartments-com route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/marketvision/apartments-com?propertyId=property-1'))
    expect(response.status).toBe(401)
  })

  it('GET returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })
    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/marketvision/apartments-com?propertyId=property-1'))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })
})

describe('marketvision apartments-com route contracts', () => {
  const updateEqMock = vi.fn().mockResolvedValue({ error: null })
  const updateMock = vi.fn(() => ({ eq: updateEqMock }))

  function mockCompetitorClient() {
    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'competitor-1',
        name: 'Comp One',
        property_id: 'property-1',
        ils_listings: { apartments_com: 'https://www.apartments.com/comp-one/abc123/' },
        last_scraped_at: null,
      },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn(() => ({ select: selectMock, update: updateMock })),
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
  })

  it('POST add_listing rejects substring-trick apartments.com URLs', async () => {
    mockCompetitorClient()
    global.fetch = vi.fn() as unknown as typeof fetch

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/apartments-com', {
        method: 'POST',
        body: JSON.stringify({
          action: 'add_listing',
          competitorId: 'competitor-1',
          url: 'https://evil.com/apartments.com/listing',
        }),
      }) as NextRequest,
    )

    expect(response.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('POST refresh_single reports failure without stamping freshness when the data engine is down', async () => {
    mockCompetitorClient()
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/apartments-com', {
        method: 'POST',
        body: JSON.stringify({
          action: 'refresh_single',
          competitorId: 'competitor-1',
        }),
      }) as NextRequest,
    )

    expect(response.status).toBe(503)
    const json = await response.json()
    expect(json.success).toBe(false)
    // Never fabricate freshness: last_scraped_at must not be updated
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('POST refresh_single forwards property_id and the API key to the data engine', async () => {
    mockCompetitorClient()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true, units_scraped: 4 }),
    }) as typeof fetch

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/apartments-com', {
        method: 'POST',
        body: JSON.stringify({
          action: 'refresh_single',
          competitorId: 'competitor-1',
        }),
      }) as NextRequest,
    )

    expect(response.status).toBe(200)
    const [calledUrl, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(calledUrl).toBe('http://data-engine.test/scraper/apartments-com/refresh')
    expect(init.headers).toMatchObject({ 'X-API-Key': 'engine-key' })
    expect(JSON.parse(init.body)).toMatchObject({
      property_id: 'property-1',
      competitor_id: 'competitor-1',
    })
  })
})
