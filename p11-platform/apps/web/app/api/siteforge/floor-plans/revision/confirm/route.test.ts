import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { getUserMock, accessMock, publishMock, queuePreviewMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  accessMock: vi.fn(),
  publishMock: vi.fn(),
  queuePreviewMock: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(() => ({})),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: accessMock,
}))
vi.mock('@/utils/siteforge/providers/manual-floor-plan-workflow', () => ({
  publishManualInventoryRevision: publishMock,
}))
vi.mock('@/utils/siteforge/workflows/canonical-preview-queue', () => ({
  queueCanonicalPreviewAfterPublication: queuePreviewMock,
}))

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'
const WEBSITE_ID = '22222222-2222-4222-8222-222222222222'
const ARTIFACT_ID = '33333333-3333-4333-8333-333333333333'

function request(overrides: Record<string, unknown> = {}): NextRequest {
  return new Request(
    'http://localhost/api/siteforge/floor-plans/revision/confirm',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId: PROPERTY_ID,
        websiteId: WEBSITE_ID,
        expectedArtifactId: ARTIFACT_ID,
        expectedCandidateContentHash: 'a'.repeat(64),
        expectedInventoryContentHash: 'b'.repeat(64),
        capturedAt: '2026-08-17T12:00:00.000Z',
        ...overrides,
      }),
    }
  ) as NextRequest
}

describe('inventory revision confirm route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({
      data: { user: { id: '44444444-4444-4444-8444-444444444444' } },
      error: null,
    })
    accessMock.mockResolvedValue({
      authorized: true,
      orgId: '66666666-6666-4666-8666-666666666666',
    })
    publishMock.mockResolvedValue({
      artifactId: '55555555-5555-4555-8555-555555555555',
      version: 4,
      contentHash: 'a'.repeat(64),
    })
    queuePreviewMock.mockResolvedValue({ status: 'running', jobId: 'preview-job' })
  })

  it('publishes only after property authorization and exact hash confirmation', async () => {
    const { POST } = await import('./route')
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: PROPERTY_ID,
        expectedArtifactId: ARTIFACT_ID,
        expectedCandidateContentHash: 'a'.repeat(64),
      }),
      expect.anything()
    )
  })

  it('returns a conflict when the reviewed preview is stale', async () => {
    publishMock.mockRejectedValue(new Error('Inventory preview is stale; create and review a new preview'))
    const { POST } = await import('./route')
    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(publishMock).toHaveBeenCalledOnce()
  })
})
