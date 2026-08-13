import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const {
  authGetUserMock,
  createClientMock,
  validatePropertyAccessMock,
  messageCreateMock,
  brandAnalyzeMock,
  createPlanRevisionMock,
  getLatestWebsitePlanRevisionMock,
} = vi.hoisted(() => ({
  authGetUserMock: vi.fn(),
  createClientMock: vi.fn(),
  validatePropertyAccessMock: vi.fn(),
  messageCreateMock: vi.fn(),
  brandAnalyzeMock: vi.fn(),
  createPlanRevisionMock: vi.fn(),
  getLatestWebsitePlanRevisionMock: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/siteforge/agents/brand-agent', () => ({
  BrandAgent: class MockBrandAgent {
    analyze = brandAnalyzeMock
  },
}))

vi.mock('@/utils/siteforge/plans/repository', () => ({
  SiteForgePlanError: class SiteForgePlanError extends Error {
    statusCode = 500
  },
  createPlanRevision: createPlanRevisionMock,
  getLatestWebsitePlanRevision: getLatestWebsitePlanRevisionMock,
}))

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: messageCreateMock,
      }
    },
  }
})

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as NextRequest
}

describe('siteforge plan route auth', () => {
  const propertyId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const websiteId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  const orgId = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    brandAnalyzeMock.mockResolvedValue({ source: 'brandforge', confidence: 1 })
    createPlanRevisionMock.mockResolvedValue({
      planId: '22222222-2222-4222-8222-222222222222',
      planVersionId: '33333333-3333-4333-8333-333333333333',
      revision: 1,
      contentHash: 'a'.repeat(64),
      status: 'ready_for_review',
      readiness: { ready: true, issues: [] },
      plan: {
        summary: 'Grounded website plan',
        brandDirection: {
          positioning: 'Verified positioning',
          visualDirection: 'Editorial',
        },
        pages: [{ title: 'Home', sections: [{ label: 'Hero' }] }],
        conversionStrategy: { primaryAction: 'tours' },
        recommendations: [],
      },
    })
    getLatestWebsitePlanRevisionMock.mockResolvedValue(null)
  })

  it('GET loads the tenant-authorized current plan for Web Director', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId })
    getLatestWebsitePlanRevisionMock.mockResolvedValue({
      planId: '22222222-2222-4222-8222-222222222222',
      revision: 2,
      status: 'ready_for_review',
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest(
        `http://localhost/api/siteforge/plan?propertyId=${propertyId}&websiteId=${websiteId}`,
      ),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      plan: expect.objectContaining({ revision: 2 }),
    })
    expect(validatePropertyAccessMock).toHaveBeenCalledWith('user-1', propertyId)
    expect(getLatestWebsitePlanRevisionMock).toHaveBeenCalledWith({
      websiteId,
      propertyId,
      orgId,
    })
  })

  it('POST returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/siteforge/plan', {
        method: 'POST',
        body: JSON.stringify({ websiteId, propertyId }),
      }),
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('POST returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/siteforge/plan', {
        method: 'POST',
        body: JSON.stringify({ websiteId, propertyId }),
      }),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('POST makes review explicit instead of inferring approval from magic phrases', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId })
    messageCreateMock.mockResolvedValue({
      content: [{ type: 'text', text: 'Current recommendation: lead with the neighborhood.' }],
      usage: { output_tokens: 20 },
      stop_reason: 'end_turn',
    })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/siteforge/plan', {
        method: 'POST',
        body: JSON.stringify({
          websiteId,
          propertyId,
          conversationHistory: [],
          userMessage: 'build it',
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        planState: 'ready_for_review',
        planId: '22222222-2222-4222-8222-222222222222',
        contentHash: 'a'.repeat(64),
        suggestedActions: ['Review plan', 'Refine with AI'],
      })
    )
    expect(createPlanRevisionMock).toHaveBeenCalledWith(
      expect.objectContaining({ websiteId, propertyId })
    )
  })
})
