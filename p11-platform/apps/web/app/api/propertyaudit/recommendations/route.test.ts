import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const generateRecommendationsMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/propertyaudit/recommendation-engine', () => ({
  generateRecommendations: generateRecommendationsMock,
}))

function mockPersistedRecommendations(rows: Array<Record<string, unknown>>) {
  createServiceClientMock.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'geo_recommendations') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  order: vi.fn().mockResolvedValue({ data: rows, error: null }),
                })),
              })),
            })),
          })),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    }),
  })
}

function makeNextRequest(url: string): NextRequest {
  const request = new Request(url) as NextRequest
  Object.defineProperty(request, 'nextUrl', {
    value: new URL(url),
    configurable: true,
  })
  return request
}

describe('propertyaudit recommendations route', () => {
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
      makeNextRequest('http://localhost/api/propertyaudit/recommendations?propertyId=property-1')
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
      makeNextRequest('http://localhost/api/propertyaudit/recommendations?propertyId=property-1')
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(generateRecommendationsMock).not.toHaveBeenCalled()
  })

  it('returns persisted LLM recommendations when a current generation exists', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId: 'org-1' })
    mockPersistedRecommendations([
      {
        id: 'rec-1',
        priority: 'medium',
        type: 'technical_fix',
        title: 'Fix title template',
        narrative: 'Narrative text',
        proposed_changes: [{ url: 'https://x.com', field: 'title', current: 'a', proposed: 'b', rationale: 'r' }],
        generation_id: 'gen-1',
        model_used: 'gpt-4o',
        created_at: '2026-07-20T00:00:00Z',
      },
      {
        id: 'rec-2',
        priority: 'high',
        type: 'content_proposal',
        title: 'Add demand page',
        narrative: 'Narrative text',
        proposed_changes: [],
        generation_id: 'gen-1',
        model_used: 'gpt-4o',
        created_at: '2026-07-20T00:00:00Z',
      },
    ])

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/recommendations?propertyId=property-1')
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.source).toBe('llm_analyst')
    // High priority sorts first.
    expect(body.recommendations[0].id).toBe('rec-2')
    expect(body.summary).toMatchObject({
      totalRecommendations: 2,
      highPriority: 1,
      mediumPriority: 1,
      proposedChangeCount: 1,
    })
    expect(generateRecommendationsMock).not.toHaveBeenCalled()
  })

  it('falls back to the legacy engine when no persisted generation exists', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId: 'org-1' })
    mockPersistedRecommendations([])
    generateRecommendationsMock.mockResolvedValue({
      recommendations: [{ id: 'legacy-1', priority: 'high' }],
      summary: { totalRecommendations: 1 },
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/recommendations?propertyId=property-1')
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.source).toBe('legacy_rules')
    expect(body.recommendations).toHaveLength(1)
    expect(generateRecommendationsMock).toHaveBeenCalledWith('property-1', {
      runId: undefined,
      batchId: undefined,
    })
  })
})
