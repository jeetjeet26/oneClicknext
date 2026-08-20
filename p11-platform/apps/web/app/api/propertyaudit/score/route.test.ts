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

describe('propertyaudit score route', () => {
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
      makeNextRequest('http://localhost/api/propertyaudit/score?propertyId=property-1')
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
      makeNextRequest('http://localhost/api/propertyaudit/score?propertyId=property-1')
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('recomputes branded and discovery rates from collapsed v1 answers', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
    })

    const thenable = (data: unknown) => {
      const builder: Record<string, unknown> = {}
      const self = () => builder
      builder.select = vi.fn(self)
      builder.eq = vi.fn(self)
      builder.order = vi.fn(self)
      builder.limit = vi.fn(self)
      builder.in = vi.fn(self)
      builder.then = (resolve: (value: { data: unknown; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data, error: null }).then(resolve, reject)
      return builder
    }

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
        if (table === 'geo_runs') {
          return thenable([
            {
              id: 'run-chatgpt',
              surface: 'chatgpt',
              started_at: '2026-08-20T00:00:00.000Z',
              geo_scores: [{ overall_score: 40, visibility_pct: 50, avg_llm_rank: 1, avg_link_rank: null, avg_sov: null, breakdown: null }],
            },
            {
              id: 'run-claude',
              surface: 'claude',
              started_at: '2026-08-20T00:00:00.000Z',
              geo_scores: [{ overall_score: 19, visibility_pct: 90, avg_llm_rank: 1, avg_link_rank: null, avg_sov: null, breakdown: null }],
            },
          ])
        }
        if (table === 'geo_queries') {
          return thenable([
            { id: 'q-branded', text: 'What is Epoca?', type: 'branded', weight: 1, run_count: 1 },
            { id: 'q-discovery', text: 'Luxury homes in Otay Ranch', type: 'category', weight: 1.2, run_count: 1 },
          ])
        }
        return thenable([
          {
            id: 'a1',
            run_id: 'run-chatgpt',
            query_id: 'q-branded',
            presence: true,
            llm_rank: 1,
            link_rank: null,
            sov: null,
            flags: [],
            created_at: '2026-08-20T00:00:00.000Z',
            answer_summary: 'Epoca is a community.',
            geo_queries: { id: 'q-branded', text: 'What is Epoca?', type: 'branded', weight: 1 },
            geo_citations: [],
          },
          {
            id: 'a2',
            run_id: 'run-chatgpt',
            query_id: 'q-discovery',
            presence: false,
            llm_rank: null,
            link_rank: null,
            sov: null,
            flags: [],
            created_at: '2026-08-20T00:00:00.000Z',
            answer_summary: 'Other communities.',
            geo_queries: { id: 'q-discovery', text: 'Luxury homes in Otay Ranch', type: 'category', weight: 1.2 },
            geo_citations: [],
          },
        ])
      }),
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/score?propertyId=property-1')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.score.brandedRecognitionPct).toBe(100)
    expect(body.score.discoveryMentionPct).toBe(0)
    expect(body.score.surfaceSummaries.find((item: { surface: string }) => item.surface === 'chatgpt')?.measured).toBe(true)
    expect(body.score.surfaceSummaries.find((item: { surface: string }) => item.surface === 'gemini')?.measured).toBe(false)
    expect(body.score.surfaces.claude).toBeUndefined()
  })
})
