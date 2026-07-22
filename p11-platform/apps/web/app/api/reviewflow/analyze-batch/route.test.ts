import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const openAiCreateMock = vi.fn()
const runBatchAnalysisMock = vi.fn()
const runSharedExecutorJobMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/reviewflow/analysis-pipeline', () => ({
  runBatchAnalysis: runBatchAnalysisMock,
}))

vi.mock('@/utils/services/shared-executor', () => ({
  runSharedExecutorJob: runSharedExecutorJobMock,
}))

vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: openAiCreateMock,
      },
    }
  },
}))

function serviceClientFor(reviews: unknown[]) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'properties') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1' }, error: null }),
            })),
          })),
        }
      }
      if (table === 'reviews') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue({ data: reviews, error: null }),
              })),
            })),
          })),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    }),
  }
}

describe('POST /api/reviewflow/analyze-batch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    openAiCreateMock.mockReset()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function buildRequest() {
    return new Request('http://localhost/api/reviewflow/analyze-batch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        propertyId: 'property-1',
        limit: 10,
      }),
    }) as NextRequest
  }

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { POST } = await import('./route')
    const response = await POST(buildRequest())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(createServiceClientMock).not.toHaveBeenCalled()
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

    const { POST } = await import('./route')
    const response = await POST(buildRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('returns success when there are no unanalyzed reviews', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    createServiceClientMock.mockReturnValue(serviceClientFor([]))

    const { POST } = await import('./route')
    const response = await POST(buildRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      analyzed: 0,
      message: 'No unanalyzed reviews found',
    })
    // No durable job is created for a no-op.
    expect(runSharedExecutorJobMock).not.toHaveBeenCalled()
  })

  it('runs analysis inside a durable shared job', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    createServiceClientMock.mockReturnValue(
      serviceClientFor([
        {
          id: 'review-1',
          review_text: 'Great place',
          rating: 5,
          property_id: 'property-1',
          reviewer_name: 'Alex',
          platform: 'google',
        },
      ])
    )
    runBatchAnalysisMock.mockResolvedValue({
      analyzed: 1,
      skipped: 0,
      manualReviewRequired: 0,
      results: [{ reviewId: 'review-1', status: 'completed' }],
    })
    runSharedExecutorJobMock.mockImplementation(async ({ execute }: { execute: () => Promise<unknown> }) => execute())

    const { POST } = await import('./route')
    const response = await POST(buildRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      analyzed: 1,
      total: 1,
    })
    expect(runSharedExecutorJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        propertyId: 'property-1',
        domain: 'reviewflow.analyze',
        requestedBy: 'user-1',
      })
    )
  })

  it('returns 503 when all review analysis attempts require manual review', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    createServiceClientMock.mockReturnValue(
      serviceClientFor([
        {
          id: 'review-1',
          review_text: 'Great place',
          rating: 5,
          property_id: 'property-1',
          reviewer_name: 'Alex',
          platform: 'google',
        },
      ])
    )
    runBatchAnalysisMock.mockResolvedValue({
      analyzed: 0,
      skipped: 0,
      manualReviewRequired: 1,
      results: [{ reviewId: 'review-1', status: 'manual_review_required' }],
    })
    runSharedExecutorJobMock.mockImplementation(async ({ execute }: { execute: () => Promise<unknown> }) => execute())

    const { POST } = await import('./route')
    const response = await POST(buildRequest())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Review analysis unavailable',
      manualReviewRequired: true,
      providerFailures: 1,
      analyzed: 0,
    })
  })
})
