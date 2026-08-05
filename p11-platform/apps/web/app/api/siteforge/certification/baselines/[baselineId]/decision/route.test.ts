import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const {
  getUserMock,
  profileSingleMock,
  validatePropertyAccessMock,
  decideVisualBaselineMock,
  assertLeaseMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  profileSingleMock: vi.fn(),
  validatePropertyAccessMock: vi.fn(),
  decideVisualBaselineMock: vi.fn(),
  assertLeaseMock: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: vi.fn(() => {
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        single: profileSingleMock,
      }
      chain.select.mockReturnValue(chain)
      chain.eq.mockReturnValue(chain)
      return chain
    }),
  })),
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(() => {
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { property_id: propertyId, website_id: baselineId },
        error: null,
      }),
    }
    chain.select.mockReturnValue(chain)
    chain.eq.mockReturnValue(chain)
    return { from: vi.fn(() => chain) }
  }),
}))
vi.mock('@/utils/siteforge/testing/aurora-lifecycle-control', async () => {
  const actual = await vi.importActual<
    typeof import('@/utils/siteforge/testing/aurora-lifecycle-control')
  >('@/utils/siteforge/testing/aurora-lifecycle-control')
  return { ...actual, assertActiveAuroraLifecycleLease: assertLeaseMock }
})

vi.mock('@/utils/siteforge/verification/visual-baselines', () => ({
  decideVisualBaseline: decideVisualBaselineMock,
  VisualBaselineError: class VisualBaselineError extends Error {
    statusCode = 409
  },
}))

const baselineId = '11111111-1111-4111-8111-111111111111'
const propertyId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

function request(
  body: Record<string, unknown> = {
    propertyId,
    operation: 'approve',
    reason: 'Approved after an independent visual review.',
  }
): NextRequest {
  return new Request(
    `http://localhost/api/siteforge/certification/baselines/${baselineId}/decision`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  ) as NextRequest
}

describe('visual baseline manager decision route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    profileSingleMock.mockResolvedValue({
      data: {
        org_id: '44444444-4444-4444-8444-444444444444',
        role: 'manager',
      },
      error: null,
    })
    decideVisualBaselineMock.mockResolvedValue({
      id: baselineId,
      status: 'approved',
    })
  })

  it('records a tenant-authorized independent manager decision', async () => {
    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({ baselineId }),
    })

    expect(response.status).toBe(200)
    expect(decideVisualBaselineMock).toHaveBeenCalledWith({
      baselineId,
      propertyId,
      reviewerProfileId: userId,
      operation: 'approve',
      reason: 'Approved after an independent visual review.',
    })
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('rejects non-manager and cross-property callers', async () => {
    const { POST } = await import('./route')
    profileSingleMock.mockResolvedValueOnce({
      data: { org_id: '44444444-4444-4444-8444-444444444444', role: 'viewer' },
      error: null,
    })
    expect(
      (
        await POST(request(), {
          params: Promise.resolve({ baselineId }),
        })
      ).status
    ).toBe(403)

    validatePropertyAccessMock.mockResolvedValueOnce({ authorized: false })
    expect(
      (
        await POST(request(), {
          params: Promise.resolve({ baselineId }),
        })
      ).status
    ).toBe(403)
    expect(decideVisualBaselineMock).not.toHaveBeenCalled()
  })
})
