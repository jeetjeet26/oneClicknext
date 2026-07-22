import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

describe('reviewflow cases route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReset()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })
  })

  it('returns 400 without reviewId', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/reviewflow/cases') as NextRequest
    )
    expect(response.status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/reviewflow/cases?reviewId=review-1') as NextRequest
    )
    expect(response.status).toBe(401)
  })

  it('returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'review-1', property_id: 'property-1' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/reviewflow/cases?reviewId=review-1') as NextRequest
    )
    expect(response.status).toBe(403)
  })

  it('returns the case, timeline events, and latest analysis', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const caseRow = { id: 'case-1', review_id: 'review-1', status: 'triaged' }
    const analysisRow = { id: 'analysis-1', review_id: 'review-1', analysis_version: 2 }
    const eventRows = [
      { id: 'event-1', event_type: 'case_created', actor_profile_id: null, payload: null, created_at: '2026-07-01T00:00:00Z' },
    ]

    fromMock.mockImplementation((table: string) => {
      if (table === 'reviews') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'review-1', property_id: 'property-1' },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'reputation_cases') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: caseRow, error: null }),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'review_analyses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: analysisRow, error: null }),
                  })),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'reputation_case_events') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({ data: eventRows, error: null }),
            })),
          })),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/reviewflow/cases?reviewId=review-1') as NextRequest
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      case: caseRow,
      events: eventRows,
      analysis: analysisRow,
    })
  })
})
