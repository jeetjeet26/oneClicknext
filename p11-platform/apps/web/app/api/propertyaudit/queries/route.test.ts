import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
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

describe('propertyaudit queries route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn(),
    })
    createServiceClientMock.mockReturnValue({
      from: vi.fn(),
    })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/queries?propertyId=property-1')
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('GET returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
      error: 'Forbidden',
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/queries?propertyId=property-1')
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('POST returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
      error: 'Forbidden',
    })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/propertyaudit/queries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ propertyId: 'property-1', query: { text: 'test', type: 'branded' } }),
      })
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('GET returns queries for an authorized property using the service client', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })

    const queryResult = {
      data: [
        {
          id: 'query-1',
          property_id: 'property-1',
          text: 'What is P11 Local Demo Property?',
          type: 'branded',
          geo: 'Austin, TX',
          weight: 1.5,
          run_count: 1,
          is_active: true,
          created_at: '2026-03-16T00:00:00.000Z',
          updated_at: '2026-03-16T00:00:00.000Z',
        },
      ],
      error: null,
    }
    const builder: Record<string, unknown> = {}
    builder.eq = vi.fn(() => builder)
    builder.order = vi.fn(() => builder)
    builder.then = (resolve: (value: typeof queryResult) => unknown) =>
      Promise.resolve(resolve(queryResult))

    const serviceFromMock = vi.fn((table: string) => {
      if (table !== 'geo_queries') throw new Error(`Unexpected table ${table}`)
      return {
        select: vi.fn(() => builder),
      }
    })

    createServiceClientMock.mockReturnValue({
      from: serviceFromMock,
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/queries?propertyId=property-1&includePerformance=false')
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      queries: [
        {
          id: 'query-1',
          propertyId: 'property-1',
          text: 'What is P11 Local Demo Property?',
          type: 'branded',
          geo: 'Austin, TX',
          weight: 1.5,
          runCount: 1,
          isActive: true,
          createdAt: '2026-03-16T00:00:00.000Z',
          updatedAt: '2026-03-16T00:00:00.000Z',
        },
      ],
      grouped: {
        branded: [
          {
            id: 'query-1',
            property_id: 'property-1',
            text: 'What is P11 Local Demo Property?',
            type: 'branded',
            geo: 'Austin, TX',
            weight: 1.5,
            run_count: 1,
            is_active: true,
            created_at: '2026-03-16T00:00:00.000Z',
            updated_at: '2026-03-16T00:00:00.000Z',
          },
        ],
        category: [],
        comparison: [],
        local: [],
        faq: [],
        voice_search: [],
      },
      total: 1,
    })
    expect(serviceFromMock).toHaveBeenCalledWith('geo_queries')
  })

  it('DELETE returns 403 when query property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
      error: 'Forbidden',
    })

    const geoQueriesSelectSingle = vi.fn().mockResolvedValue({
      data: { property_id: 'property-1' },
      error: null,
    })
    const geoQueriesDeleteEq = vi.fn()

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'geo_queries') throw new Error(`Unexpected table ${table}`)
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: geoQueriesSelectSingle,
            })),
          })),
          delete: vi.fn(() => ({
            eq: geoQueriesDeleteEq,
          })),
        }
      }),
    })

    const { DELETE } = await import('./route')
    const response = await DELETE(
      makeNextRequest('http://localhost/api/propertyaudit/queries?queryId=query-1', {
        method: 'DELETE',
      })
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(geoQueriesDeleteEq).not.toHaveBeenCalled()
  })
})
