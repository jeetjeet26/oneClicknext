import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  expectJsonError,
  makeJsonRequest,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/test/route-test-helpers'

const {
  authGetUserMock,
  createClientMock,
  validatePropertyAccessMock,
  decideSiteForgePlanMock,
  fromMock,
} = vi.hoisted(() => ({
  authGetUserMock: vi.fn(),
  createClientMock: vi.fn(),
  validatePropertyAccessMock: vi.fn(),
  decideSiteForgePlanMock: vi.fn(),
  fromMock: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/siteforge/plans/repository', () => ({
  SiteForgePlanError: class SiteForgePlanError extends Error {
    statusCode = 409
  },
  decideSiteForgePlan: decideSiteForgePlanMock,
}))

const planId = '11111111-1111-4111-8111-111111111111'
const propertyId = '22222222-2222-4222-8222-222222222222'
const websiteId = '44444444-4444-4444-8444-444444444444'
const orgId = '55555555-5555-4555-8555-555555555555'
const requestBody = {
  websiteId,
  propertyId,
  expectedRevision: 2,
  contentHash: 'a'.repeat(64),
  decisionStatus: 'approved',
}

function profileQuery(role: string) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue({
    data: { role },
    error: null,
  })
  return builder
}

describe('SiteForge plan decision route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })
  })

  it('requires authentication', async () => {
    mockUnauthenticatedUser(authGetUserMock)

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest(`http://localhost/api/siteforge/plans/${planId}/decision`, {
        body: requestBody,
      }),
      { params: Promise.resolve({ planId }) }
    )

    await expectJsonError(response, 401, 'Unauthorized')
  })

  it('requires an approval-capable role', async () => {
    mockAuthenticatedUser(authGetUserMock)
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId })
    fromMock.mockReturnValue(profileQuery('member'))

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest(`http://localhost/api/siteforge/plans/${planId}/decision`, {
        body: requestBody,
      }),
      { params: Promise.resolve({ planId }) }
    )

    await expectJsonError(response, 403, 'Approval permission required')
  })

  it('records an explicit revision-bound approval', async () => {
    mockAuthenticatedUser(authGetUserMock)
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId })
    fromMock.mockReturnValue(profileQuery('manager'))
    decideSiteForgePlanMock.mockResolvedValue({
      planId,
      revision: 2,
      contentHash: 'a'.repeat(64),
      status: 'confirmed',
      approvalId: '33333333-3333-4333-8333-333333333333',
    })

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest(`http://localhost/api/siteforge/plans/${planId}/decision`, {
        body: requestBody,
      }),
      { params: Promise.resolve({ planId }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        success: true,
        planId,
        revision: 2,
        status: 'confirmed',
      })
    )
    expect(decideSiteForgePlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        planId,
        websiteId,
        propertyId,
        orgId,
        expectedRevision: 2,
        contentHash: 'a'.repeat(64),
        decisionStatus: 'approved',
        decisionReason: 'siteforge.plan:confirmed_for_generation:v1',
      })
    )
  })
})
