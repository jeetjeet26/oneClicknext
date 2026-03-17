import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockServerClient,
  expectJsonError,
  makeJsonRequest,
  makeNextRequest,
  mockAuthenticatedUser,
  mockForbiddenPropertyAccess,
  mockUnauthenticatedUser,
} from '@/test/route-test-helpers'

const authGetUserMock = vi.fn()
const createServerClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createServerClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

describe('forgestudio templates route', () => {
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

  it('GET returns 401 when unauthenticated', async () => {
    mockUnauthenticatedUser(authGetUserMock)

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/forgestudio/templates?propertyId=property-1')
    )

    await expectJsonError(response, 401, 'Unauthorized')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('GET returns 403 when property access is denied', async () => {
    mockAuthenticatedUser(authGetUserMock)
    mockForbiddenPropertyAccess(validatePropertyAccessMock)

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/forgestudio/templates?propertyId=property-1')
    )

    await expectJsonError(response, 403, 'Forbidden')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('POST returns 403 when property access is denied', async () => {
    mockAuthenticatedUser(authGetUserMock)
    mockForbiddenPropertyAccess(validatePropertyAccessMock)

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest('http://localhost/api/forgestudio/templates', {
        body: {
          propertyId: 'property-1',
          name: 'Template',
          contentType: 'post',
          promptTemplate: 'Write a post',
        },
      })
    )

    await expectJsonError(response, 403, 'Forbidden')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('DELETE returns 403 when template property access is denied', async () => {
    mockAuthenticatedUser(authGetUserMock)
    mockForbiddenPropertyAccess(validatePropertyAccessMock)

    const deleteEqMock = vi.fn()
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'content_templates') {
        throw new Error(`Unexpected table ${table}`)
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 'template-1', property_id: 'property-1' },
              error: null,
            }),
          })),
        })),
        delete: vi.fn(() => ({
          eq: deleteEqMock,
        })),
      }
    })

    const { DELETE } = await import('./route')
    const response = await DELETE(
      makeNextRequest('http://localhost/api/forgestudio/templates?templateId=template-1')
    )

    await expectJsonError(response, 403, 'Forbidden')
    expect(deleteEqMock).not.toHaveBeenCalled()
  })
})
