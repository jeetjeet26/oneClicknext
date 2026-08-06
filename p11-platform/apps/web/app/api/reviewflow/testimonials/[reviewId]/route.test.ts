import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  authGetUser,
  createClient,
  createServiceClient,
  validatePropertyManagerAccess,
  from,
} = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  validatePropertyManagerAccess: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({ createClient }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient }))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyManagerAccess,
}))

const reviewId = '11111111-1111-4111-8111-111111111111'
const propertyId = '22222222-2222-4222-8222-222222222222'

function request(method: 'POST' | 'DELETE', body: unknown): NextRequest {
  return new Request(
    `http://localhost/api/reviewflow/testimonials/${reviewId}`,
    {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  ) as NextRequest
}

function builder(result: unknown) {
  const value: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['select', 'eq', 'insert', 'update']) {
    value[method] = vi.fn(() => value)
  }
  value.single = vi.fn().mockResolvedValue(result)
  value.maybeSingle = vi.fn().mockResolvedValue(result)
  return value
}

const reviewResult = {
  data: {
    id: reviewId,
    property_id: propertyId,
    reviewer_name: 'A Resident',
    review_text: 'A thoughtful place to live.',
    rating: 5,
    platform: 'google',
    review_date: '2026-08-01T12:00:00.000Z',
    content_fingerprint: null,
  },
  error: null,
}

describe('ReviewFlow testimonial publication route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClient.mockResolvedValue({ auth: { getUser: authGetUser } })
    createServiceClient.mockReturnValue({ from })
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    validatePropertyManagerAccess.mockResolvedValue({ authorized: true })
  })

  it('requires explicit attribution and rights evidence', async () => {
    const { POST } = await import('./route')
    const response = await POST(request('POST', {}), {
      params: Promise.resolve({ reviewId }),
    })

    expect(response.status).toBe(400)
    expect(from).not.toHaveBeenCalled()
  })

  it('stores an immutable approved-content snapshot', async () => {
    const reviewBuilder = builder(reviewResult)
    const approvalBuilder = builder({
      data: { id: '33333333-3333-4333-8333-333333333333' },
      error: null,
    })
    from
      .mockReturnValueOnce(reviewBuilder)
      .mockReturnValueOnce(approvalBuilder)

    const { POST } = await import('./route')
    const response = await POST(
      request('POST', {
        attributionApproved: true,
        rightsBasis: 'direct_consent',
        evidenceNote: 'Written consent retained by property management.',
      }),
      { params: Promise.resolve({ reviewId }) }
    )

    expect(response.status).toBe(201)
    expect(approvalBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        review_id: reviewId,
        property_id: propertyId,
        reviewer_name_snapshot: 'A Resident',
        review_text_snapshot: 'A thoughtful place to live.',
        attribution_approved: true,
        rights_basis: 'direct_consent',
        approved_by: 'user-1',
        content_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    )
  })

  it('revokes the active approval with an auditable reason', async () => {
    const reviewBuilder = builder(reviewResult)
    const approvalBuilder = builder({
      data: { id: '33333333-3333-4333-8333-333333333333' },
      error: null,
    })
    from
      .mockReturnValueOnce(reviewBuilder)
      .mockReturnValueOnce(approvalBuilder)

    const { DELETE } = await import('./route')
    const response = await DELETE(
      request('DELETE', { reason: 'Resident withdrew publication consent.' }),
      { params: Promise.resolve({ reviewId }) }
    )

    expect(response.status).toBe(200)
    expect(approvalBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'revoked',
        revoked_by: 'user-1',
        revocation_reason: 'Resident withdrew publication consent.',
      })
    )
  })
})
