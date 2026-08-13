import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUser = vi.fn()
const profileSingle = vi.fn()
const validateAccess = vi.fn()
const decideBrief = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: authGetUser },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single: profileSingle })),
      })),
    })),
  })),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validateAccess,
}))
vi.mock('@/utils/services/request-context', () => ({
  createRequestContext: () => ({
    responseHeaders: { 'X-Request-Id': 'decision-request' },
    logStart: vi.fn(),
    logSuccess: vi.fn(),
    logError: vi.fn(),
  }),
}))
vi.mock('@/utils/siteforge/briefs/repository', async () => {
  const actual = await vi.importActual<
    typeof import('@/utils/siteforge/briefs/repository')
  >('@/utils/siteforge/briefs/repository')
  return { ...actual, decideSiteForgeBrief: decideBrief }
})

const BRIEF_ID = '11111111-1111-4111-8111-111111111111'
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222'

function request() {
  return new Request('http://localhost/api/siteforge/briefs/x/decision', {
    method: 'POST',
    body: JSON.stringify({
      propertyId: PROPERTY_ID,
      contentHash: 'a'.repeat(64),
      decisionStatus: 'approved',
      decisionReason: 'Reviewed with the property team.',
    }),
  }) as NextRequest
}

describe('SiteForge brief decision route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authGetUser.mockResolvedValue({
      data: { user: { id: 'manager-1' } },
      error: null,
    })
    validateAccess.mockResolvedValue({ authorized: true })
    profileSingle.mockResolvedValue({
      data: { role: 'manager' },
      error: null,
    })
    decideBrief.mockResolvedValue({ decisionStatus: 'approved' })
  })

  it('requires a manager even for a tenant-authorized user', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'member' }, error: null })
    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({ briefVersionId: BRIEF_ID }),
    })
    expect(response.status).toBe(403)
    expect(decideBrief).not.toHaveBeenCalled()
  })

  it('binds the decision to the exact hash and authenticated reviewer', async () => {
    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({ briefVersionId: BRIEF_ID }),
    })
    expect(response.status).toBe(200)
    expect(decideBrief).toHaveBeenCalledWith({
      briefVersionId: BRIEF_ID,
      propertyId: PROPERTY_ID,
      reviewerProfileId: 'manager-1',
      contentHash: 'a'.repeat(64),
      decisionStatus: 'approved',
      decisionReason: 'Reviewed with the property team.',
      modifiedBrief: undefined,
      unresolvedContradictions: undefined,
    })
  })
})
