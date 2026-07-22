import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const serviceFromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => ({ from: serviceFromMock }),
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

/** Chainable query mock resolving to the provided result at any await point. */
function chainResult(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  for (const method of ['select', 'eq', 'neq', 'is', 'in', 'gte', 'lt', 'order', 'limit']) {
    chain[method] = vi.fn(self)
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

describe('reviewflow insights route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceFromMock.mockReset()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('returns 400 without propertyId', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/reviewflow/insights') as NextRequest
    )
    expect(response.status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/reviewflow/insights?propertyId=p1') as NextRequest
    )
    expect(response.status).toBe(401)
  })

  it('returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/reviewflow/insights?propertyId=p1') as NextRequest
    )
    expect(response.status).toBe(403)
  })

  it('returns issue clusters with recommendation-only interventions', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const now = Date.now()
    const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString()

    serviceFromMock.mockImplementation((table: string) => {
      if (table === 'reviews') {
        return chainResult({
          data: [
            {
              id: 'review-1',
              rating: 1,
              sentiment: 'negative',
              review_text: 'Maintenance never fixed my leaking sink.',
              review_date: daysAgo(5),
              created_at: daysAgo(5),
              is_urgent: false,
            },
            {
              id: 'review-2',
              rating: 2,
              sentiment: 'negative',
              review_text: 'Work orders take weeks to be addressed.',
              review_date: daysAgo(10),
              created_at: daysAgo(10),
              is_urgent: false,
            },
            {
              id: 'review-3',
              rating: 5,
              sentiment: 'positive',
              review_text: 'Great pool and gym!',
              review_date: daysAgo(3),
              created_at: daysAgo(3),
              is_urgent: false,
            },
          ],
          error: null,
        })
      }
      if (table === 'reputation_cases') {
        return chainResult({
          data: [
            {
              id: 'case-1',
              review_id: 'review-1',
              status: 'triaged',
              priority: 'high',
              issue_domains: ['maintenance'],
              reopened_count: 1,
              created_at: daysAgo(5),
              resolved_at: null,
            },
          ],
          error: null,
        })
      }
      if (table === 'review_analyses') {
        return chainResult({
          data: [
            {
              review_id: 'review-1',
              issue_domains: ['maintenance'],
              severity: 'high',
              journey_stage: 'residency',
              created_at: daysAgo(5),
            },
            {
              review_id: 'review-2',
              issue_domains: ['maintenance'],
              severity: 'medium',
              journey_stage: 'residency',
              created_at: daysAgo(10),
            },
            {
              review_id: 'review-3',
              issue_domains: ['amenities'],
              severity: null,
              journey_stage: 'residency',
              created_at: daysAgo(3),
            },
          ],
          error: null,
        })
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/reviewflow/insights?propertyId=p1&days=90') as NextRequest
    )

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.windowDays).toBe(90)
    expect(json.totalReviews).toBe(3)
    expect(json.classifiedReviews).toBe(3)
    expect(json.attributionLimits).toContain('never matched')

    const maintenance = json.clusters.find(
      (c: { issueDomain: string }) => c.issueDomain === 'maintenance'
    )
    expect(maintenance).toBeTruthy()
    expect(maintenance.reviewCount).toBe(2)
    expect(maintenance.negativeCount).toBe(2)
    expect(maintenance.openCases).toBe(1)
    expect(maintenance.reopenedCases).toBe(1)
    // 2 negative reviews → recommendation with evidence and measurement window.
    expect(maintenance.recommendation).toMatchObject({
      interventionType: 'internal_followup',
      suggestedOwnerRole: 'maintenance_lead',
    })
    expect(maintenance.recommendation.measurement.windowDays).toBeGreaterThan(0)
    expect(maintenance.evidence.length).toBeGreaterThan(0)
    expect(maintenance.evidence[0].reviewId).toBeTruthy()

    // Single positive amenities review is not enough signal for a recommendation.
    const amenities = json.clusters.find(
      (c: { issueDomain: string }) => c.issueDomain === 'amenities'
    )
    expect(amenities.recommendation).toBeNull()
  })
})
