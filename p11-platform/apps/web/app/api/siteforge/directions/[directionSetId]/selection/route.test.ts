import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUser = vi.fn()
const validateAccess = vi.fn()
const selectDirection = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: authGetUser } })),
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
  return { ...actual, selectSiteForgeCreativeDirection: selectDirection }
})

const SET_ID = '11111111-1111-4111-8111-111111111111'
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222'
const DIRECTION_ID = '33333333-3333-4333-8333-333333333333'

describe('creative direction selection route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validateAccess.mockResolvedValue({ authorized: true })
    selectDirection.mockResolvedValue({ id: SET_ID })
  })

  it('binds selection to the tenant, set hash, and direction identity', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/siteforge/directions/x/selection', {
        method: 'POST',
        body: JSON.stringify({
          propertyId: PROPERTY_ID,
          selectedDirectionId: DIRECTION_ID,
          expectedContentHash: 'a'.repeat(64),
          selectionNotes: 'Best balance',
        }),
      }) as NextRequest,
      { params: Promise.resolve({ directionSetId: SET_ID }) }
    )
    expect(response.status).toBe(200)
    expect(selectDirection).toHaveBeenCalledWith({
      directionSetId: SET_ID,
      propertyId: PROPERTY_ID,
      selectedDirectionId: DIRECTION_ID,
      expectedContentHash: 'a'.repeat(64),
      selectionNotes: 'Best balance',
    })
  })
})
