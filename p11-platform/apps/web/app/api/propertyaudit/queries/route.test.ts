import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { retrieveCompetitorKbContext } from '@/utils/services/competitor-kb'

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

vi.mock('@/utils/services/competitor-kb', () => ({
  retrieveCompetitorKbContext: vi.fn().mockResolvedValue({
    contextText: '',
    competitorNames: [],
    chunks: [],
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

function makeCompetitorQuery(data: Array<Record<string, unknown>>) {
  const result = { data, error: null }
  const builder: Record<string, unknown> = {}
  builder.eq = vi.fn(() => builder)
  builder.limit = vi.fn().mockResolvedValue(result)
  builder.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(resolve(result))
  return builder
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

  it('POST does not generate seeded queries when property access is denied', async () => {
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
        body: JSON.stringify({
          propertyId: 'property-1',
          generateFromProperty: true,
          seedKeywords: [{ keyword: '2 bedroom Townhomes near me', conversions: 12 }],
        }),
      })
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(createServiceClientMock).not.toHaveBeenCalled()
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

  it('POST generates for-sale residential queries without apartment defaults', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })

    let insertedQueries: Array<Record<string, unknown>> = []
    const serviceFromMock = vi.fn((table: string) => {
      if (table === 'properties') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'property-1',
                  name: 'Acacia',
                  address: { city: 'Palo Alto', state: 'CA', street: '420 Acacia Avenue' },
                  property_type: 'townhome',
                  amenities: ['Rooftop Deck', 'EV Charging'],
                  special_features: [],
                },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'competitors') {
        return {
          select: vi.fn(() => makeCompetitorQuery([])),
        }
      }
      if (table === 'brand_books') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({ data: null, error: null }),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'geo_queries') {
        return {
          insert: vi.fn((queries: Array<Record<string, unknown>>) => {
            insertedQueries = queries
            return {
              select: vi.fn().mockResolvedValue({
                data: queries.map((query, index) => ({
                  id: `query-${index}`,
                  created_at: '2026-03-16T00:00:00.000Z',
                  updated_at: '2026-03-16T00:00:00.000Z',
                  ...query,
                })),
                error: null,
              }),
            }
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    createServiceClientMock.mockReturnValue({
      from: serviceFromMock,
    })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/propertyaudit/queries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ propertyId: 'property-1', generateFromProperty: true }),
      })
    )

    expect(response.status).toBe(200)
    expect(insertedQueries.map(query => query.text).join(' ')).toContain('townhomes for sale')
    expect(insertedQueries.map(query => query.text).join(' ')).not.toContain('apartment communities')
    expect(insertedQueries.map(query => query.text).join(' ')).not.toContain('Best apartments')
  })

  it('POST prefers enriched competitors for comparison query generation', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    vi.mocked(retrieveCompetitorKbContext).mockResolvedValueOnce({
      contextText: '',
      competitorNames: ['Vector KB Villas'],
      chunks: [],
    })

    let insertedQueries: Array<Record<string, unknown>> = []
    const serviceFromMock = vi.fn((table: string) => {
      if (table === 'properties') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'property-1',
                  name: 'Acacia',
                  address: { city: 'Palo Alto', state: 'CA', street: '420 Acacia Avenue' },
                  property_type: 'townhome',
                  amenities: [],
                  special_features: [],
                },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'competitors') {
        return {
          select: vi.fn(() => makeCompetitorQuery([
            {
              id: 'competitor-low',
              name: 'Low Confidence Homes',
              is_active: true,
              brand_intel: { confidence_score: 0.4, last_analyzed_at: '2026-03-16T00:00:00.000Z' },
            },
            {
              id: 'competitor-high',
              name: 'Enriched Homes',
              is_active: true,
              brand_intel: { confidence_score: 0.9, last_analyzed_at: '2026-03-17T00:00:00.000Z' },
            },
          ])),
        }
      }
      if (table === 'brand_books') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({ data: null, error: null }),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'geo_queries') {
        return {
          insert: vi.fn((queries: Array<Record<string, unknown>>) => {
            insertedQueries = queries
            return {
              select: vi.fn().mockResolvedValue({
                data: queries.map((query, index) => ({
                  id: `query-${index}`,
                  created_at: '2026-03-16T00:00:00.000Z',
                  updated_at: '2026-03-16T00:00:00.000Z',
                  ...query,
                })),
                error: null,
              }),
            }
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    createServiceClientMock.mockReturnValue({
      from: serviceFromMock,
    })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/propertyaudit/queries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ propertyId: 'property-1', generateFromProperty: true }),
      })
    )

    expect(response.status).toBe(200)
    const comparisonQueries = insertedQueries.filter(query => query.type === 'comparison')
    expect(comparisonQueries[0].text).toBe('Compare Acacia with Enriched Homes for townhome communities in Palo Alto, CA')
    expect(comparisonQueries.map(query => query.text)).toContain('Compare Acacia with Vector KB Villas for townhome communities in Palo Alto, CA')
  })

  it('POST generates comparison queries for every available competitor', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })

    let insertedQueries: Array<Record<string, unknown>> = []
    const serviceFromMock = vi.fn((table: string) => {
      if (table === 'properties') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'property-1',
                  name: 'Persimmon',
                  address: { city: 'Pomona', state: 'CA', street: '675 E. Mission Blvd' },
                  property_type: 'townhome',
                  amenities: [],
                  special_features: [],
                },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'competitors') {
        return {
          select: vi.fn(() => makeCompetitorQuery(
            Array.from({ length: 12 }, (_, index) => ({
              id: `competitor-${index + 1}`,
              name: `Competitor ${index + 1}`,
              is_active: true,
              brand_intel: { confidence_score: 0.9 - index * 0.05, last_analyzed_at: `2026-03-${17 - index}T00:00:00.000Z` },
            }))
          )),
        }
      }
      if (table === 'brand_books') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({ data: null, error: null }),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'geo_queries') {
        return {
          insert: vi.fn((queries: Array<Record<string, unknown>>) => {
            insertedQueries = queries
            return {
              select: vi.fn().mockResolvedValue({
                data: queries.map((query, index) => ({
                  id: `query-${index}`,
                  created_at: '2026-03-16T00:00:00.000Z',
                  updated_at: '2026-03-16T00:00:00.000Z',
                  ...query,
                })),
                error: null,
              }),
            }
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    createServiceClientMock.mockReturnValue({
      from: serviceFromMock,
    })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/propertyaudit/queries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ propertyId: 'property-1', generateFromProperty: true }),
      })
    )

    expect(response.status).toBe(200)
    const comparisonQueryTexts = insertedQueries
      .filter(query => query.type === 'comparison')
      .map(query => query.text)
    expect(insertedQueries.length).toBeGreaterThan(24)
    expect(comparisonQueryTexts).toHaveLength(12)
    expect(comparisonQueryTexts).toContain('Compare Persimmon with Competitor 12 for townhome communities in Pomona, CA')
  })

  it('POST blends seed keywords into generated discovery prompts without replacing enriched comparisons', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    vi.mocked(retrieveCompetitorKbContext).mockResolvedValueOnce({
      contextText: '',
      competitorNames: ['Vector KB Villas'],
      chunks: [],
    })

    let insertedQueries: Array<Record<string, unknown>> = []
    const serviceFromMock = vi.fn((table: string) => {
      if (table === 'properties') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'property-1',
                  name: 'Acacia',
                  address: { city: 'Glendora', state: 'CA', street: '420 Acacia Avenue' },
                  property_type: 'townhome',
                  amenities: ['EV Charging', 'Rooftop Deck'],
                  special_features: [],
                },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'competitors') {
        return {
          select: vi.fn(() => makeCompetitorQuery([
            {
              id: 'competitor-high',
              name: 'Enriched Homes',
              is_active: true,
              brand_intel: { confidence_score: 0.9, last_analyzed_at: '2026-03-17T00:00:00.000Z' },
            },
          ])),
        }
      }
      if (table === 'brand_books') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({ data: null, error: null }),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'geo_queries') {
        return {
          insert: vi.fn((queries: Array<Record<string, unknown>>) => {
            insertedQueries = queries
            return {
              select: vi.fn().mockResolvedValue({
                data: queries.map((query, index) => ({
                  id: `query-${index}`,
                  created_at: '2026-03-16T00:00:00.000Z',
                  updated_at: '2026-03-16T00:00:00.000Z',
                  ...query,
                })),
                error: null,
              }),
            }
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    createServiceClientMock.mockReturnValue({
      from: serviceFromMock,
    })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/propertyaudit/queries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          propertyId: 'property-1',
          generateFromProperty: true,
          seedKeywords: [
            { keyword: '2 bedroom Townhomes near me', conversions: 24, interactions: 632 },
            { keyword: 'new townhomes for sale Glendora', impressions: 1200, interactions: 50 },
            { keyword: 'Enriched Homes', conversions: 99 },
          ],
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(insertedQueries).toHaveLength(24)
    expect(insertedQueries.map(query => query.text)).toContain('2 bedroom Townhomes near me')
    expect(insertedQueries.map(query => query.text)).toContain('new townhomes for sale Glendora')
    expect(insertedQueries.filter(query => query.type === 'comparison').map(query => query.text)).toContain('Compare Acacia with Enriched Homes for townhome communities in Glendora, CA')
    expect(insertedQueries.map(query => query.text)).not.toContain('Enriched Homes')
  })

  it('POST dedupes and caps seed keyword influence', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })

    let insertedQueries: Array<Record<string, unknown>> = []
    const serviceFromMock = vi.fn((table: string) => {
      if (table === 'properties') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'property-1',
                  name: 'Acacia',
                  address: { city: 'Glendora', state: 'CA', street: '420 Acacia Avenue' },
                  property_type: 'townhome',
                  amenities: [],
                  special_features: [],
                },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'competitors') {
        return { select: vi.fn(() => makeCompetitorQuery([])) }
      }
      if (table === 'brand_books') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({ data: null, error: null }),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'geo_queries') {
        return {
          insert: vi.fn((queries: Array<Record<string, unknown>>) => {
            insertedQueries = queries
            return {
              select: vi.fn().mockResolvedValue({
                data: queries.map((query, index) => ({
                  id: `query-${index}`,
                  created_at: '2026-03-16T00:00:00.000Z',
                  updated_at: '2026-03-16T00:00:00.000Z',
                  ...query,
                })),
                error: null,
              }),
            }
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    createServiceClientMock.mockReturnValue({
      from: serviceFromMock,
    })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/propertyaudit/queries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          propertyId: 'property-1',
          generateFromProperty: true,
          seedKeywords: [
            ' ',
            'Total: Account',
            { keyword: 'Glendora new construction', conversions: 1 },
            { keyword: 'glendora new construction', conversions: 10 },
            ...Array.from({ length: 20 }, (_, index) => ({ keyword: `seed phrase ${index}`, interactions: index })),
          ],
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(insertedQueries).toHaveLength(24)
    expect(insertedQueries.filter(query => String(query.text).toLowerCase() === 'glendora new construction')).toHaveLength(1)
    expect(insertedQueries.filter(query => String(query.text).startsWith('seed phrase'))).toHaveLength(3)
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
