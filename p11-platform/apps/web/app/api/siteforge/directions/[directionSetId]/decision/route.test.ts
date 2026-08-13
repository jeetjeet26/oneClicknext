import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUser = vi.fn()
const profileSingle = vi.fn()
const validateAccess = vi.fn()
const decideDirection = vi.fn()

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
    responseHeaders: {},
    logStart: vi.fn(),
    logSuccess: vi.fn(),
    logError: vi.fn(),
  }),
}))
vi.mock('@/utils/siteforge/directions/repository', async () => {
  const actual = await vi.importActual<
    typeof import('@/utils/siteforge/directions/repository')
  >('@/utils/siteforge/directions/repository')
  return { ...actual, decideSiteForgeCreativeDirection: decideDirection }
})

const SET_ID = '11111111-1111-4111-8111-111111111111'
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222'
const DIRECTION_ID = '33333333-3333-4333-8333-333333333333'

describe('creative direction decision route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authGetUser.mockResolvedValue({
      data: { user: { id: 'manager-1' } },
      error: null,
    })
    profileSingle.mockResolvedValue({
      data: { role: 'manager' },
      error: null,
    })
    validateAccess.mockResolvedValue({ authorized: true })
    decideDirection.mockResolvedValue({ decisionStatus: 'approved' })
  })

  it('requires a manager for approval', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'member' }, error: null })
    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/siteforge/directions/x/decision', {
        method: 'POST',
        body: JSON.stringify({
          propertyId: PROPERTY_ID,
          contentHash: 'a'.repeat(64),
          selectedDirectionId: DIRECTION_ID,
          decisionStatus: 'approved',
          decisionReason: 'Approved',
        }),
      }) as NextRequest,
      { params: Promise.resolve({ directionSetId: SET_ID }) }
    )
    expect(response.status).toBe(403)
    expect(decideDirection).not.toHaveBeenCalled()
  })

  it('passes exact set and selected hashes to the approval service', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/siteforge/directions/x/decision', {
        method: 'POST',
        body: JSON.stringify({
          propertyId: PROPERTY_ID,
          contentHash: 'a'.repeat(64),
          selectedDirectionId: DIRECTION_ID,
          decisionStatus: 'approved',
          decisionReason: 'Approved after comparison.',
        }),
      }) as NextRequest,
      { params: Promise.resolve({ directionSetId: SET_ID }) }
    )
    expect(response.status).toBe(200)
    expect(decideDirection).toHaveBeenCalledWith({
      directionSetId: SET_ID,
      propertyId: PROPERTY_ID,
      reviewerProfileId: 'manager-1',
      contentHash: 'a'.repeat(64),
      selectedDirectionId: DIRECTION_ID,
      decisionStatus: 'approved',
      decisionReason: 'Approved after comparison.',
      modifiedDirection: undefined,
    })
  })
})
