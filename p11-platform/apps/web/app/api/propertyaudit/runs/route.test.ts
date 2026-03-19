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

describe('propertyaudit runs route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/runs?propertyId=property-1')
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
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

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/runs?propertyId=property-1')
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns 400 when surface filter is invalid', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/runs?propertyId=property-1&surface=other')
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid surface. Allowed values: openai, claude',
    })
  })

  it('returns empty results with summary for authorized user', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })

    const queryResult = { data: [], error: null, count: 0 }
    const builder: Record<string, unknown> = {}
    builder.eq = vi.fn(() => builder)
    builder.order = vi.fn(() => builder)
    builder.range = vi.fn(() => builder)
    builder.then = (resolve: (value: typeof queryResult) => unknown) =>
      Promise.resolve(resolve(queryResult))

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
        if (table !== 'geo_runs') throw new Error(`Unexpected table ${table}`)
        return {
          select: vi.fn(() => builder),
        }
      }),
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/runs?propertyId=property-1')
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      runs: [],
      total: 0,
      summary: {
        openai: null,
        claude: null,
        combined: null,
      },
    })
  })

  it('surfaces persisted running progress and stalled hints', async () => {
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
          id: 'run-1',
          property_id: 'property-1',
          surface: 'openai',
          model_name: 'gpt-5.2',
          status: 'running',
          query_count: 10,
          progress_pct: 42,
          current_query_index: 4,
          last_updated_at: '2026-03-16T00:00:00.000Z',
          started_at: '2026-03-16T00:00:00.000Z',
          finished_at: null,
          error_message: null,
          uses_web_search: true,
          geo_scores: [],
        },
      ],
      error: null,
      count: 1,
    }
    const builder: Record<string, unknown> = {}
    builder.eq = vi.fn(() => builder)
    builder.order = vi.fn(() => builder)
    builder.range = vi.fn(() => builder)
    builder.then = (resolve: (value: typeof queryResult) => unknown) =>
      Promise.resolve(resolve(queryResult))

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
        if (table !== 'geo_runs') throw new Error(`Unexpected table ${table}`)
        return {
          select: vi.fn(() => builder),
        }
      }),
    })

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-03-16T00:05:00.000Z'))

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/runs?propertyId=property-1')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.runs).toHaveLength(1)
    expect(body.runs[0]).toMatchObject({
      id: 'run-1',
      status: 'running',
      progressPct: 42,
      currentQueryIndex: 4,
      statusLabel: 'Running',
      usesWebSearch: true,
      isPossiblyStalled: true,
    })
    expect(String(body.runs[0].statusDetail)).toContain('Possibly stalled')
    expect(body.runs[0].secondsSinceUpdate).toBe(300)

    nowSpy.mockRestore()
  })
})
