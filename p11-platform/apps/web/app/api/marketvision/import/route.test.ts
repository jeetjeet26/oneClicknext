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

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as NextRequest
}

describe('marketvision import route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('POST returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/import', {
        method: 'POST',
        body: JSON.stringify({ property_id: 'property-1' }),
      }),
    )
    expect(response.status).toBe(401)
  })

  it('POST returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })
    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/import', {
        method: 'POST',
        body: JSON.stringify({ property_id: 'property-1' }),
      }),
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('POST returns 500 when the data-engine API key is missing', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const originalApiKey = process.env.DATA_ENGINE_API_KEY
    delete process.env.DATA_ENGINE_API_KEY

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/import', {
        method: 'POST',
        body: JSON.stringify({ property_id: 'property-1' }),
      }),
    )

    process.env.DATA_ENGINE_API_KEY = originalApiKey

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'DATA_ENGINE_API_KEY is required to trigger MarketVision imports.',
    })
  })
})
