import { beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('marketvision alerts route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue(createMockServerClient(authGetUserMock))
  })

  it('GET returns 401 when unauthenticated', async () => {
    mockUnauthenticatedUser(authGetUserMock)
    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/marketvision/alerts?propertyId=property-1'))
    await expectJsonError(response, 401, 'Unauthorized')
  })

  it('GET returns 403 when property access is denied', async () => {
    mockAuthenticatedUser(authGetUserMock)
    mockForbiddenPropertyAccess(validatePropertyAccessMock)
    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/marketvision/alerts?propertyId=property-1'))
    await expectJsonError(response, 403, 'Forbidden')
  })
})

describe('marketvision alerts route PUT scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('PUT rejects requests without propertyId', async () => {
    createClientMock.mockResolvedValue(createMockServerClient(authGetUserMock))
    mockAuthenticatedUser(authGetUserMock)
    const { PUT } = await import('./route')
    const response = await PUT(
      makeNextRequest('http://localhost/api/marketvision/alerts', {
        method: 'PUT',
        body: JSON.stringify({ alertIds: ['alert-1'], action: 'read' }),
      }),
    )
    await expectJsonError(response, 400, 'propertyId required')
  })

  it('PUT scopes individual alert updates to the property', async () => {
    mockAuthenticatedUser(authGetUserMock)
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const propertyEqMock = vi.fn().mockResolvedValue({ error: null })
    const inMock = vi.fn().mockReturnValue({ eq: propertyEqMock })
    const updateMock = vi.fn().mockReturnValue({ in: inMock })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn(() => ({ update: updateMock })),
    })

    const { PUT } = await import('./route')
    const response = await PUT(
      makeNextRequest('http://localhost/api/marketvision/alerts', {
        method: 'PUT',
        body: JSON.stringify({
          alertIds: ['alert-1', 'alert-2'],
          action: 'read',
          propertyId: 'property-1',
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(inMock).toHaveBeenCalledWith('id', ['alert-1', 'alert-2'])
    expect(propertyEqMock).toHaveBeenCalledWith('property_id', 'property-1')
  })
})
