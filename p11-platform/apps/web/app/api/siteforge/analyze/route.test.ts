import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const {
  authGetUserMock,
  createClientMock,
  validatePropertyAccessMock,
  fromMock,
  brandAnalyzeMock,
} = vi.hoisted(() => ({
  authGetUserMock: vi.fn(),
  createClientMock: vi.fn(),
  validatePropertyAccessMock: vi.fn(),
  fromMock: vi.fn(),
  brandAnalyzeMock: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/siteforge/agents', () => ({
  BrandAgent: class MockBrandAgent {
    analyze = brandAnalyzeMock
  },
}))

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  const request = new Request(url, init) as NextRequest
  Object.defineProperty(request, 'nextUrl', {
    value: new URL(url),
    configurable: true,
  })
  return request
}

describe('siteforge analyze route auth', () => {
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
    const response = await GET(makeNextRequest('http://localhost/api/siteforge/analyze?propertyId=property-1'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('GET returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const singleMock = vi.fn().mockResolvedValue({
      data: { id: 'property-1', name: 'P', org_id: 'org-1' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/siteforge/analyze?propertyId=property-1'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('GET reports evidence quality and missing-source warnings', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    brandAnalyzeMock.mockResolvedValue({
      source: 'knowledge_base',
      confidence: 0.72,
      brandPersonality: { primary: 'welcoming' },
    })

    fromMock.mockImplementation((table: string) => {
      if (table === 'properties') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'property-1', name: 'Aurora Denver', org_id: 'org-1' },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'documents') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: [], error: null }),
              then: undefined,
            }),
          }),
        }
      }
      if (table === 'property_brand_assets') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { generation_status: 'pending' },
                error: null,
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/siteforge/analyze?propertyId=property-1')
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        analysisQuality: expect.objectContaining({
          level: 'good',
          warnings: expect.arrayContaining([
            'No completed BrandForge brand book was found.',
            'No property photos were found; generated imagery may be required.',
          ]),
        }),
      })
    )
  })
})
