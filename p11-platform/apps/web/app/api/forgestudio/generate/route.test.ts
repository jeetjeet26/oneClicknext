import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import {
  createMockServerClient,
  expectJsonError,
  makeJsonRequest,
  mockAuthenticatedUser,
  mockForbiddenPropertyAccess,
  mockUnauthenticatedUser,
} from '@/test/route-test-helpers'

const authGetUserMock = vi.fn()
const createServerClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createServerClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(),
  })),
}))

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: vi.fn(),
      },
    }
  },
}))

describe('forgestudio generate route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    createServerClientMock.mockResolvedValue(
      createMockServerClient(authGetUserMock)
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POST returns 401 when unauthenticated', async () => {
    mockUnauthenticatedUser(authGetUserMock)

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest('http://localhost/api/forgestudio/generate', {
        body: { propertyId: 'property-1', contentType: 'post' },
      })
    )

    await expectJsonError(response, 401, 'Unauthorized')
  })

  it('POST returns 403 when property access is denied', async () => {
    mockAuthenticatedUser(authGetUserMock)
    mockForbiddenPropertyAccess(validatePropertyAccessMock)

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest('http://localhost/api/forgestudio/generate', {
        body: { propertyId: 'property-1', contentType: 'post' },
      })
    )

    await expectJsonError(response, 403, 'Forbidden')
  })
})
