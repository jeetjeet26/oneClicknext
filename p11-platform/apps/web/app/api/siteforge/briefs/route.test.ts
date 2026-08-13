import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUser = vi.fn()
const validateAccess = vi.fn()
const listBriefs = vi.fn()
const createBrief = vi.fn()
const saveCurrentBrief = vi.fn()
const websiteMaybeSingle = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: authGetUser } })),
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: websiteMaybeSingle })),
      })),
    })),
  })),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validateAccess,
}))
vi.mock('@/utils/services/request-context', () => ({
  createRequestContext: () => ({
    responseHeaders: { 'X-Request-Id': 'brief-request' },
    logStart: vi.fn(),
    logSuccess: vi.fn(),
    logError: vi.fn(),
  }),
}))
vi.mock('@/utils/siteforge/briefs/repository', async () => {
  const actual = await vi.importActual<
    typeof import('@/utils/siteforge/briefs/repository')
  >('@/utils/siteforge/briefs/repository')
  return {
    ...actual,
    listSiteForgeBriefVersions: listBriefs,
    createSiteForgeBriefVersion: createBrief,
    saveCurrentSiteForgeBrief: saveCurrentBrief,
  }
})

const WEBSITE_ID = '11111111-1111-4111-8111-111111111111'
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333'

describe('/api/siteforge/briefs tenant contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validateAccess.mockResolvedValue({ authorized: true })
    websiteMaybeSingle.mockResolvedValue({
      data: { property_id: PROPERTY_ID },
      error: null,
    })
    listBriefs.mockResolvedValue([])
    createBrief.mockResolvedValue({
      id: 'brief-1',
      websiteId: WEBSITE_ID,
      propertyId: PROPERTY_ID,
      version: 1,
    })
    saveCurrentBrief.mockResolvedValue({
      id: 'brief-2',
      websiteId: WEBSITE_ID,
      propertyId: PROPERTY_ID,
      version: 2,
      status: 'approved',
    })
  })

  it('rejects unauthenticated list requests before reading records', async () => {
    authGetUser.mockResolvedValue({ data: { user: null }, error: null })
    const { GET } = await import('./route')
    const response = await GET(
      new Request(
        `http://localhost/api/siteforge/briefs?websiteId=${WEBSITE_ID}`
      ) as NextRequest
    )
    expect(response.status).toBe(401)
    expect(listBriefs).not.toHaveBeenCalled()
  })

  it('enforces property access for website-scoped listing', async () => {
    validateAccess.mockResolvedValue({ authorized: false })
    const { GET } = await import('./route')
    const response = await GET(
      new Request(
        `http://localhost/api/siteforge/briefs?websiteId=${WEBSITE_ID}`
      ) as NextRequest
    )
    expect(response.status).toBe(403)
    expect(validateAccess).toHaveBeenCalledWith('user-1', PROPERTY_ID)
    expect(listBriefs).not.toHaveBeenCalled()
  })

  it('passes the authenticated actor and exact website to immutable creation', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/siteforge/briefs', {
        method: 'POST',
        body: JSON.stringify({
          websiteId: WEBSITE_ID,
          expectedVersion: 0,
          status: 'draft',
          brief: {},
          unresolvedContradictions: [],
        }),
      }) as NextRequest
    )
    expect(response.status).toBe(201)
    expect(createBrief).toHaveBeenCalledWith(
      expect.objectContaining({
        websiteId: WEBSITE_ID,
        userId: 'user-1',
        expectedVersion: 0,
      })
    )
  })

  it('saves and confirms a contradiction-free immutable current brief', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/siteforge/briefs', {
        method: 'POST',
        body: JSON.stringify({
          websiteId: WEBSITE_ID,
          expectedVersion: 1,
          saveAsCurrent: true,
          brief: {},
          unresolvedContradictions: [],
        }),
      }) as NextRequest
    )
    expect(response.status).toBe(201)
    expect(saveCurrentBrief).toHaveBeenCalledWith({
      websiteId: WEBSITE_ID,
      expectedVersion: 1,
      brief: {},
      unresolvedContradictions: [],
      userId: 'user-1',
    })
    expect(createBrief).not.toHaveBeenCalled()
  })
})
