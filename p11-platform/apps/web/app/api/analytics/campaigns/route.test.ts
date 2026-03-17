import { beforeEach, describe, it, vi } from 'vitest'
import {
  createMockServerClient,
  expectJsonError,
  makeNextRequest,
  mockAuthenticatedUser,
  mockForbiddenPropertyAccess,
  mockUnauthenticatedUser,
} from '@/test/route-test-helpers'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

describe('analytics campaigns route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue(
      createMockServerClient(authGetUserMock, { from: vi.fn() })
    )
  })

  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticatedUser(authGetUserMock)

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/analytics/campaigns?propertyId=property-1')
    )

    await expectJsonError(response, 401, 'Unauthorized')
  })

  it('returns 403 when property access is denied', async () => {
    mockAuthenticatedUser(authGetUserMock)
    mockForbiddenPropertyAccess(validatePropertyAccessMock)

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/analytics/campaigns?propertyId=property-1')
    )

    await expectJsonError(response, 403, 'Forbidden')
  })
})
