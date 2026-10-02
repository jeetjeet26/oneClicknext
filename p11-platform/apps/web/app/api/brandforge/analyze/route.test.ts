import { beforeEach, describe, it, vi } from 'vitest'
import {
  createMockServerClient,
  expectJsonError,
  makeJsonRequest,
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

describe('brandforge analyze route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue(createMockServerClient(authGetUserMock))
  })

  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticatedUser(authGetUserMock)

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest('http://localhost/api/brandforge/analyze', {
        body: { propertyId: '33333333-3333-3333-3333-333333333333', requestId:'55555555-5555-4555-8555-555555555555', mode:'saved' },
      })
    )

    await expectJsonError(response, 401, 'Unauthorized')
  })

  it('returns 403 when property access is denied', async () => {
    mockAuthenticatedUser(authGetUserMock)
    mockForbiddenPropertyAccess(validatePropertyAccessMock)

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest('http://localhost/api/brandforge/analyze', {
        body: { propertyId: '33333333-3333-3333-3333-333333333333', requestId:'55555555-5555-4555-8555-555555555555', mode:'saved' },
      })
    )

    await expectJsonError(response, 403, 'Forbidden')
  })
})
