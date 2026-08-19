import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authGetUser = vi.fn()
const validateAccess = vi.fn()
const validateManagerAccess = vi.fn()
const getCurrentProfile = vi.fn()
const createProfile = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: authGetUser } })),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validateAccess,
  validatePropertyManagerAccess: validateManagerAccess,
}))
vi.mock('@/utils/services/request-context', () => ({
  createRequestContext: () => ({
    responseHeaders: { 'X-Request-Id': 'vertical-profile-test' },
    logStart: vi.fn(),
    logSuccess: vi.fn(),
    logError: vi.fn(),
  }),
}))
vi.mock('@/utils/real-estate/repository', async () => {
  const actual = await vi.importActual<
    typeof import('@/utils/real-estate/repository')
  >('@/utils/real-estate/repository')
  return {
    ...actual,
    getCurrentPropertyVerticalProfile: getCurrentProfile,
    createPropertyVerticalProfileVersion: createProfile,
  }
})

const PROPERTY_ID = '33333333-3333-4333-8333-333333333333'
const ORG_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'

const requestBody = {
  profile: {
    schemaVersion: 2,
    subjectKind: 'real_estate_property',
    verticalKey: 'multifamily_residential',
    displayName: 'Multifamily residential',
    operatingModel: 'rental_residential',
    attributes: { leaseModel: 'traditional' },
    audiences: ['prospective_residents'],
    complianceTags: ['fair_housing'],
    source: 'operator',
  },
  mappingStatus: 'confirmed',
  mappingReason: null,
  verticalPack: {
    key: 'siteforge.real_estate.multifamily_residential',
    version: 2,
  },
  expectedVersion: 1,
}

function context() {
  return { params: Promise.resolve({ id: PROPERTY_ID }) }
}

describe('/api/properties/[id]/vertical-profile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authGetUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    })
    validateAccess.mockResolvedValue({ authorized: true, orgId: ORG_ID })
    validateManagerAccess.mockResolvedValue({
      authorized: true,
      orgId: ORG_ID,
    })
    getCurrentProfile.mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
      propertyId: PROPERTY_ID,
      orgId: ORG_ID,
      version: 1,
      mappingStatus: 'confirmed',
    })
    createProfile.mockResolvedValue({
      reused: false,
      profile: {
        id: '55555555-5555-4555-8555-555555555555',
        propertyId: PROPERTY_ID,
        orgId: ORG_ID,
        version: 2,
        mappingStatus: 'confirmed',
      },
    })
  })

  it('rejects unauthenticated reads', async () => {
    authGetUser.mockResolvedValue({ data: { user: null }, error: null })
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest(
        `http://localhost/api/properties/${PROPERTY_ID}/vertical-profile`
      ),
      context()
    )

    expect(response.status).toBe(401)
    expect(validateAccess).not.toHaveBeenCalled()
    expect(getCurrentProfile).not.toHaveBeenCalled()
  })

  it('loads the current profile only inside the authorized tenant', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest(
        `http://localhost/api/properties/${PROPERTY_ID}/vertical-profile`
      ),
      context()
    )

    expect(response.status).toBe(200)
    expect(validateAccess).toHaveBeenCalledWith(USER_ID, PROPERTY_ID)
    expect(getCurrentProfile).toHaveBeenCalledWith({
      orgId: ORG_ID,
      propertyId: PROPERTY_ID,
    })
  })

  it('requires manager access before writing a version', async () => {
    validateManagerAccess.mockResolvedValue({ authorized: false })
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest(
        `http://localhost/api/properties/${PROPERTY_ID}/vertical-profile`,
        { method: 'POST', body: JSON.stringify(requestBody) }
      ),
      context()
    )

    expect(response.status).toBe(403)
    expect(createProfile).not.toHaveBeenCalled()
  })

  it('rejects an unversioned or malformed profile contract', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest(
        `http://localhost/api/properties/${PROPERTY_ID}/vertical-profile`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...requestBody,
            profile: { ...requestBody.profile, schemaVersion: 1 },
          }),
        }
      ),
      context()
    )

    expect(response.status).toBe(400)
    expect(createProfile).not.toHaveBeenCalled()
  })

  it('persists an immutable profile version with tenant identity', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest(
        `http://localhost/api/properties/${PROPERTY_ID}/vertical-profile`,
        { method: 'POST', body: JSON.stringify(requestBody) }
      ),
      context()
    )

    expect(response.status).toBe(201)
    expect(createProfile).toHaveBeenCalledWith({
      orgId: ORG_ID,
      propertyId: PROPERTY_ID,
      userId: USER_ID,
      value: requestBody,
    })
    await expect(response.json()).resolves.toMatchObject({
      reused: false,
      profile: { version: 2 },
    })
  })
})
