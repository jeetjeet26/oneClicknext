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

describe('propertyaudit query by id route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn(),
    })
  })

  it('PATCH returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/propertyaudit/queries/query-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'updated query' }),
      }) as NextRequest,
      { params: Promise.resolve({ queryId: 'query-1' }) }
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('PATCH returns 403 when property access is denied', async () => {
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
    const geoQueriesUpdateSingle = vi.fn()

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
        if (table !== 'geo_queries') throw new Error(`Unexpected table ${table}`)
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: geoQueriesSelectSingle,
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: geoQueriesUpdateSingle,
              })),
            })),
          })),
        }
      }),
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/propertyaudit/queries/query-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'updated query' }),
      }) as NextRequest,
      { params: Promise.resolve({ queryId: 'query-1' }) }
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(geoQueriesUpdateSingle).not.toHaveBeenCalled()
  })

  it('PATCH updates editable query fields for authorized users', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })

    const geoQueriesSelectSingle = vi.fn().mockResolvedValue({
      data: { property_id: 'property-1' },
      error: null,
    })
    const geoQueriesUpdate = vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'query-1',
              property_id: 'property-1',
              text: payload.text,
              type: payload.type,
              geo: payload.geo,
              weight: payload.weight,
              run_count: 1,
              is_active: true,
              created_at: '2026-03-16T00:00:00.000Z',
              updated_at: payload.updated_at,
            },
            error: null,
          }),
        })),
      })),
    }))

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
        if (table !== 'geo_queries') throw new Error(`Unexpected table ${table}`)
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: geoQueriesSelectSingle,
            })),
          })),
          update: geoQueriesUpdate,
        }
      }),
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/propertyaudit/queries/query-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: '  Compare Persimmon with Belcourt Place  ',
          type: 'comparison',
          geo: ' Pomona, CA ',
          weight: 1.4,
        }),
      }) as NextRequest,
      { params: Promise.resolve({ queryId: 'query-1' }) }
    )

    expect(response.status).toBe(200)
    expect(geoQueriesUpdate).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Compare Persimmon with Belcourt Place',
      type: 'comparison',
      geo: 'Pomona, CA',
      weight: 1.4,
    }))
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      query: {
        id: 'query-1',
        text: 'Compare Persimmon with Belcourt Place',
        type: 'comparison',
        geo: 'Pomona, CA',
        weight: 1.4,
      },
    })
  })

  it('DELETE returns 403 when property access is denied', async () => {
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

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
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
      new Request('http://localhost/api/propertyaudit/queries/query-1', {
        method: 'DELETE',
      }) as NextRequest,
      { params: Promise.resolve({ queryId: 'query-1' }) }
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(geoQueriesDeleteEq).not.toHaveBeenCalled()
  })
})
