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

function makeNextRequest(url: string): NextRequest {
  const request = new Request(url) as NextRequest
  Object.defineProperty(request, 'nextUrl', {
    value: new URL(url),
    configurable: true,
  })
  return request
}

describe('propertyaudit query executions route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn(),
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/queries/query-1/executions'),
      { params: Promise.resolve({ queryId: 'query-1' }) }
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 404 when query does not exist', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
        if (table !== 'geo_queries') throw new Error(`Unexpected table ${table}`)
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
            })),
          })),
        }
      }),
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/queries/query-1/executions'),
      { params: Promise.resolve({ queryId: 'query-1' }) }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Query not found' })
  })

  it('returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
      error: 'Forbidden',
    })

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
        if (table !== 'geo_queries') throw new Error(`Unexpected table ${table}`)
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { property_id: 'property-1' },
                error: null,
              }),
            })),
          })),
        }
      }),
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/queries/query-1/executions'),
      { params: Promise.resolve({ queryId: 'query-1' }) }
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns empty executions when authorized and no rows exist', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
        if (table === 'geo_queries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { property_id: 'property-1' },
                  error: null,
                }),
              })),
            })),
          }
        }
        if (table === 'geo_answers') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({
                    data: [],
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/queries/query-1/executions'),
      { params: Promise.resolve({ queryId: 'query-1' }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      queryId: 'query-1',
      executions: [],
      aggregates: {
        totalExecutions: 0,
        presenceRate: 0,
        medianLlmRank: null,
        medianLinkRank: null,
        medianSov: null,
        surfaces: {},
      },
    })
  })
})
