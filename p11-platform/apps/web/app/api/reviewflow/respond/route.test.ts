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

vi.mock('openai', () => {
  return {
    default: class OpenAI {
      chat = {
        completions: {
          create: vi.fn(),
        },
      }
    },
  }
})

describe('reviewflow respond route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReset()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })
  })

  it('returns 401 for POST when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/reviewflow/respond', {
        method: 'POST',
        body: JSON.stringify({ reviewId: 'review-1' }),
      }) as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 for POST when review property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const singleMock = vi.fn().mockResolvedValue({
      data: { id: 'review-1', property_id: 'property-1' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/reviewflow/respond', {
        method: 'POST',
        body: JSON.stringify({ reviewId: 'review-1' }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns 403 for PATCH when response property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'response-1',
        review_id: 'review-1',
        reviews: { property_id: 'property-1' },
      },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/reviewflow/respond', {
        method: 'PATCH',
        body: JSON.stringify({ responseId: 'response-1', action: 'approve' }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns 409 for PATCH post when the response is not approved', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'response-1',
        review_id: 'review-1',
        status: 'draft',
        reviews: { property_id: 'property-1' },
      },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/reviewflow/respond', {
        method: 'PATCH',
        body: JSON.stringify({ responseId: 'response-1', action: 'post', manualConfirmed: true }),
      }) as NextRequest
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Only approved responses can be marked as posted',
    })
  })

  it('returns 400 for PATCH post when manual confirmation is missing', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'response-1',
        review_id: 'review-1',
        status: 'approved',
        reviews: { property_id: 'property-1' },
      },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/reviewflow/respond', {
        method: 'PATCH',
        body: JSON.stringify({ responseId: 'response-1', action: 'post' }),
      }) as NextRequest
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'manualConfirmed is required to mark a response as posted',
    })
  })

  it('returns 400 for PATCH post when provider evidence is missing', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'response-1',
        review_id: 'review-1',
        status: 'approved',
        reviews: { property_id: 'property-1' },
      },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/reviewflow/respond', {
        method: 'PATCH',
        body: JSON.stringify({ responseId: 'response-1', action: 'post', manualConfirmed: true }),
      }) as NextRequest
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'providerPostId or providerPostUrl is required to confirm provider-side execution',
    })
  })

  it('records provider evidence audit ticket before marking response posted', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const reviewResponsesSelectSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          id: 'response-1',
          review_id: 'review-1',
          status: 'approved',
          reviews: { property_id: 'property-1' },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          review_id: 'review-1',
          reviews: {
            id: 'review-1',
            platform: 'google',
            property_id: 'property-1',
          },
        },
        error: null,
      })
    const reviewResponsesSelectEq = vi.fn().mockReturnValue({ single: reviewResponsesSelectSingle })
    const reviewResponsesSelect = vi.fn().mockReturnValue({ eq: reviewResponsesSelectEq })

    const reviewResponsesUpdateSingle = vi.fn().mockResolvedValue({
      data: { review_id: 'review-1' },
      error: null,
    })
    const reviewResponsesUpdateEq = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: reviewResponsesUpdateSingle }) })
    const reviewResponsesUpdate = vi.fn().mockReturnValue({ eq: reviewResponsesUpdateEq })

    const reviewTicketsInsertSingle = vi.fn().mockResolvedValue({
      data: { id: 'ticket-1' },
      error: null,
    })
    const reviewTicketsInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single: reviewTicketsInsertSingle }),
    })

    const reviewsUpdateEq = vi.fn().mockResolvedValue({ data: null, error: null })
    const reviewsUpdate = vi.fn().mockReturnValue({ eq: reviewsUpdateEq })

    fromMock.mockImplementation((table: string) => {
      if (table === 'review_responses') {
        return {
          select: reviewResponsesSelect,
          update: reviewResponsesUpdate,
        }
      }
      if (table === 'review_tickets') {
        return {
          insert: reviewTicketsInsert,
          delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) })),
        }
      }
      if (table === 'reviews') {
        return {
          update: reviewsUpdate,
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/reviewflow/respond', {
        method: 'PATCH',
        body: JSON.stringify({
          responseId: 'response-1',
          action: 'post',
          manualConfirmed: true,
          providerPostUrl: 'https://maps.google.com/review/reply/123',
        }),
      }) as NextRequest
    )

    const json = await response.json()
    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      success: true,
      status: 'posted',
      postingMode: 'manual_confirmed',
      auditTicketId: 'ticket-1',
    })
    expect(reviewTicketsInsert).toHaveBeenCalledTimes(1)
    expect(reviewTicketsInsert.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        review_id: 'review-1',
        property_id: 'property-1',
        status: 'resolved',
      })
    )
  })
})
