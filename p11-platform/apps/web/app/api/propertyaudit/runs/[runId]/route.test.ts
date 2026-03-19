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

describe('propertyaudit runs/[runId] route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/runs/run-1', {
      method: 'GET',
    }) as NextRequest

    const response = await GET(request, {
      params: Promise.resolve({ runId: 'run-1' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(createServiceClientMock).not.toHaveBeenCalled()
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

    const geoRunsSingle = vi.fn().mockResolvedValue({
      data: { id: 'run-1', property_id: 'property-1' },
      error: null,
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'geo_runs') throw new Error(`Unexpected table ${table}`)
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: geoRunsSingle,
            })),
          })),
        }
      }),
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/runs/run-1', {
      method: 'GET',
    }) as NextRequest

    const response = await GET(request, {
      params: Promise.resolve({ runId: 'run-1' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
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

    const geoRunsSingle = vi.fn().mockResolvedValue({
      data: { id: 'run-1', property_id: 'property-1', surface: 'openai', started_at: '2026-01-01T00:00:00Z' },
      error: null,
    })
    const geoRunsDeleteEq = vi.fn()

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'geo_runs') throw new Error(`Unexpected table ${table}`)
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: geoRunsSingle,
            })),
          })),
          delete: vi.fn(() => ({
            eq: geoRunsDeleteEq,
          })),
        }
      }),
    })

    const { DELETE } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/runs/run-1', {
      method: 'DELETE',
    }) as NextRequest

    const response = await DELETE(request, {
      params: Promise.resolve({ runId: 'run-1' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(geoRunsDeleteEq).not.toHaveBeenCalled()
  })

  it('GET includes persisted progress metadata for running runs', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })

    const geoRunsSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'run-1',
        property_id: 'property-1',
        surface: 'openai',
        model_name: 'gpt-5.2',
        status: 'running',
        query_count: 10,
        current_query_index: 3,
        progress_pct: 30,
        last_updated_at: '2026-03-16T00:00:00.000Z',
        error_message: null,
        started_at: '2026-03-16T00:00:00.000Z',
        finished_at: null,
        uses_web_search: true,
        geo_scores: [],
      },
      error: null,
    })
    const geoAnswersOrder = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'geo_runs') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: geoRunsSingle,
              })),
            })),
          }
        }
        if (table === 'geo_answers') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: geoAnswersOrder,
              })),
            })),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-03-16T00:05:00.000Z'))

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/runs/run-1', {
      method: 'GET',
    }) as NextRequest

    const response = await GET(request, {
      params: Promise.resolve({ runId: 'run-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.run).toMatchObject({
      id: 'run-1',
      status: 'running',
      progressPct: 30,
      currentQueryIndex: 3,
      isPossiblyStalled: true,
      usesWebSearch: true,
    })
    expect(String(body.run.statusDetail)).toContain('Possibly stalled')
    expect(body.run.secondsSinceUpdate).toBe(300)

    nowSpy.mockRestore()
  })
})
