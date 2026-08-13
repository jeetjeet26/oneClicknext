import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUser = vi.fn()
const validateAccess = vi.fn()
const createDirections = vi.fn()
const listDirections = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: authGetUser } })),
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(() => ({ from: vi.fn() })),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validateAccess,
}))
vi.mock('@/utils/services/request-context', () => ({
  createRequestContext: () => ({
    responseHeaders: { 'X-Request-Id': 'directions-request' },
    logStart: vi.fn(),
    logSuccess: vi.fn(),
    logError: vi.fn(),
  }),
}))
vi.mock('@/utils/siteforge/directions/repository', async () => {
  const actual = await vi.importActual<
    typeof import('@/utils/siteforge/directions/repository')
  >('@/utils/siteforge/directions/repository')
  return {
    ...actual,
    createSiteForgeDirectionSet: createDirections,
    listSiteForgeDirectionSets: listDirections,
  }
})

const BRIEF_ID = '11111111-1111-4111-8111-111111111111'
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333'

describe('/api/siteforge/directions tenant contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validateAccess.mockResolvedValue({ authorized: true })
    createDirections.mockResolvedValue({
      id: 'set-1',
      websiteId: 'website-1',
      propertyId: PROPERTY_ID,
    })
    listDirections.mockResolvedValue([])
  })

  it('fails closed before generation when property access is denied', async () => {
    validateAccess.mockResolvedValue({ authorized: false })
    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/siteforge/directions', {
        method: 'POST',
        body: JSON.stringify({
          briefVersionId: BRIEF_ID,
          propertyId: PROPERTY_ID,
        }),
      }) as NextRequest
    )
    expect(response.status).toBe(403)
    expect(createDirections).not.toHaveBeenCalled()
  })

  it('creates directions only through the authenticated property scope', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/siteforge/directions', {
        method: 'POST',
        body: JSON.stringify({
          briefVersionId: BRIEF_ID,
          propertyId: PROPERTY_ID,
          expectedSetVersion: 0,
        }),
      }) as NextRequest
    )
    expect(response.status).toBe(201)
    expect(createDirections).toHaveBeenCalledWith({
      briefVersionId: BRIEF_ID,
      propertyId: PROPERTY_ID,
      expectedSetVersion: 0,
      userId: 'user-1',
    })
  })

  it('supports tenant-safe property listing for wizard resume entry points', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new Request(
        `http://localhost/api/siteforge/directions?propertyId=${PROPERTY_ID}`
      ) as NextRequest
    )
    expect(response.status).toBe(200)
    expect(validateAccess).toHaveBeenCalledWith('user-1', PROPERTY_ID)
    expect(listDirections).toHaveBeenCalledWith({
      websiteId: undefined,
      propertyId: PROPERTY_ID,
    })
  })
})
