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
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://example.com/file' } })),
      })),
    },
  })),
}))

vi.mock('openai', () => ({
  default: class OpenAI {
    embeddings = {
      create: vi.fn(),
    }
  },
}))

describe('brandforge embed-to-kb route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createServerClientMock.mockResolvedValue(
      createMockServerClient(authGetUserMock)
    )
  })

  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticatedUser(authGetUserMock)

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest('http://localhost/api/brandforge/embed-to-kb', {
        body: { brandAssetId: 'brand-1', propertyId: 'property-1' },
      })
    )

    await expectJsonError(response, 401, 'Unauthorized')
  })

  it('returns 403 when property access is denied', async () => {
    mockAuthenticatedUser(authGetUserMock)
    mockForbiddenPropertyAccess(validatePropertyAccessMock)

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest('http://localhost/api/brandforge/embed-to-kb', {
        body: { brandAssetId: 'brand-1', propertyId: 'property-1' },
      })
    )

    await expectJsonError(response, 403, 'Forbidden')
  })
})
