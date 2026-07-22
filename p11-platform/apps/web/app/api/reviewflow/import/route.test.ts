import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const persistObservedReviewsMock = vi.fn()
const ensureCaseForReviewMock = vi.fn()
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

vi.mock('@/utils/reviewflow/ingestion', () => ({
  persistObservedReviews: persistObservedReviewsMock,
}))

vi.mock('@/utils/reviewflow/cases', () => ({
  ensureCaseForReview: ensureCaseForReviewMock,
}))

vi.mock('@/utils/reviewflow/analysis-pipeline', () => ({
  runBatchAnalysis: runBatchAnalysisMock,
}))

vi.mock('@/utils/services/shared-executor', () => ({
  runSharedExecutorJob: runSharedExecutorJobMock,
}))

describe('POST /api/reviewflow/import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function buildRequest() {
    const formData = new FormData()
    formData.set(
      'file',
      new File(['platform,review_text\ngoogle,"Great experience"'], 'reviews.csv', {
        type: 'text/csv',
      })
    )
    formData.set('propertyId', 'property-1')

    return new Request('http://localhost/api/reviewflow/import', {
      method: 'POST',
      body: formData,
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

  it('imports reviews replay-safely inside a durable shared job', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })

    createServiceClientMock.mockReturnValue({
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
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const insertedReview = {
      id: 'review-1',
      property_id: 'property-1',
      review_text: 'Great experience',
      rating: null,
      reviewer_name: 'Anonymous',
      platform: 'google',
    }
    persistObservedReviewsMock.mockResolvedValue({
      inserted: 1,
      updated: 0,
      unchanged: 0,
      insertedReviews: [insertedReview],
    })
    ensureCaseForReviewMock.mockResolvedValue({ id: 'case-1' })
    runBatchAnalysisMock.mockResolvedValue({
      analyzed: 1,
      manualReviewRequired: 0,
      skipped: 0,
      results: [],
    })
    runSharedExecutorJobMock.mockImplementation(async ({ execute }: { execute: () => Promise<unknown> }) => execute())

    const { POST } = await import('./route')
    const response = await POST(buildRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      imported: 1,
      inserted: 1,
      updated: 0,
      unchanged: 0,
      analyzed: 1,
    })

    // Persistence goes through the replay-safe upsert path...
    expect(persistObservedReviewsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        propertyId: 'property-1',
        platform: 'google',
        retrievalMethod: 'csv_import',
      })
    )
    // ...every new review gets a reputation case...
    expect(ensureCaseForReviewMock).toHaveBeenCalledWith(expect.anything(), insertedReview)
    // ...and the work runs inside a durable shared job.
    expect(runSharedExecutorJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        propertyId: 'property-1',
        domain: 'reviewflow.import',
        requestedBy: 'user-1',
      })
    )
  })
})
