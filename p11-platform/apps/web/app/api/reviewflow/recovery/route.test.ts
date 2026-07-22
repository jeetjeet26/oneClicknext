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
  for (const method of ['select', 'eq', 'neq', 'is', 'in', 'lt', 'order', 'limit']) {
    chain[method] = vi.fn(self)
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

describe('reviewflow recovery route', () => {
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
      new Request('http://localhost/api/reviewflow/recovery') as NextRequest
    )
    expect(response.status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/reviewflow/recovery?propertyId=p1') as NextRequest
    )
    expect(response.status).toBe(401)
  })

  it('returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/reviewflow/recovery?propertyId=p1') as NextRequest
    )
    expect(response.status).toBe(403)
  })

  it('surfaces failed executions, stuck approvals, and unverified posts', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    let responsesCall = 0
    serviceFromMock.mockImplementation((table: string) => {
      if (table === 'shared_action_attempts') {
        return chainResult({
          data: [
            {
              id: 'attempt-1',
              execution_status: 'failed',
              error_message: 'GBP token expired',
              executed_at: '2026-07-20T00:00:00Z',
              updated_at: '2026-07-20T00:00:00Z',
            },
          ],
          error: null,
        })
      }
      if (table === 'review_responses') {
        responsesCall += 1
        if (responsesCall === 1) {
          // Responses linked to failed attempts.
          return chainResult({
            data: [
              {
                id: 'response-1',
                review_id: 'review-1',
                status: 'approved',
                shared_action_attempt_id: 'attempt-1',
                reviews: { platform: 'google', property_id: 'p1' },
              },
            ],
            error: null,
          })
        }
        if (responsesCall === 2) {
          // Stuck approved responses.
          return chainResult({
            data: [
              {
                id: 'response-2',
                review_id: 'review-2',
                status: 'approved',
                approved_at: '2026-07-01T00:00:00Z',
                reviews: { platform: 'yelp', property_id: 'p1' },
              },
            ],
            error: null,
          })
        }
        // Unverified provider posts.
        return chainResult({
          data: [
            {
              id: 'response-3',
              review_id: 'review-3',
              status: 'posted',
              posted_at: '2026-07-19T00:00:00Z',
              posting_mode: 'provider_api',
              platform_response_id: null,
              reviews: { platform: 'google', property_id: 'p1' },
            },
          ],
          error: null,
        })
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/reviewflow/recovery?propertyId=p1') as NextRequest
    )

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.counts).toEqual({
      failed_execution: 1,
      stuck_approved: 1,
      unverified_post: 1,
    })
    expect(json.items).toHaveLength(3)
    const failed = json.items.find((i: { kind: string }) => i.kind === 'failed_execution')
    expect(failed).toMatchObject({
      responseId: 'response-1',
      reviewId: 'review-1',
      platform: 'google',
      reason: 'GBP token expired',
    })
  })
})
