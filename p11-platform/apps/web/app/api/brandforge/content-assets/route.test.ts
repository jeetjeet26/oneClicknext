import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authGetUser = vi.fn()
const validateAccess = vi.fn()
const validateManagerAccess = vi.fn()
const serviceFrom = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: authGetUser } })),
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(() => ({ from: serviceFrom })),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validateAccess,
  validatePropertyManagerAccess: validateManagerAccess,
}))
vi.mock('@/utils/services/request-context', () => ({
  createRequestContext: () => ({
    responseHeaders: { 'X-Request-Id': 'brand-assets-request' },
    logStart: vi.fn(),
    logSuccess: vi.fn(),
    logError: vi.fn(),
  }),
}))
vi.mock('@/utils/storage/asset-service', () => ({
  STORAGE_BUCKETS: { PROPERTY_ASSETS: 'property-assets' },
  uploadFileAsset: vi.fn(),
}))

const PROPERTY_ID = '33333333-3333-3333-3333-333333333333'
const ASSET_ID = '44444444-4444-4444-8444-444444444444'

function assetListQuery() {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.order = vi.fn().mockResolvedValue({ data: [], error: null })
  return chain
}

describe('/api/brandforge/content-assets property identity validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validateAccess.mockResolvedValue({ authorized: true, orgId: 'org-1' })
    validateManagerAccess.mockResolvedValue({ authorized: true, orgId: 'org-1' })
    serviceFrom.mockReturnValue(assetListQuery())
  })

  it('accepts a valid Postgres UUID property identifier', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest(
        `http://localhost/api/brandforge/content-assets?propertyId=${PROPERTY_ID}`
      )
    )

    expect(response.status).toBe(200)
    expect(validateAccess).toHaveBeenCalledWith('user-1', PROPERTY_ID)
  })

  it('retains strict generated UUID validation for asset identifiers', async () => {
    const { PATCH } = await import('./route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/brandforge/content-assets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: PROPERTY_ID,
          assetId: '44444444-4444-4444-4444-444444444444',
          approvalStatus: 'approved',
          rightsStatus: 'owned',
        }),
      })
    )

    expect(response.status).toBe(400)
    expect(validateManagerAccess).not.toHaveBeenCalled()
  })

  it('curates a rights-cleared brand asset when a manager approves it', async () => {
    const query: Record<string, ReturnType<typeof vi.fn>> = {
      update: vi.fn(),
      eq: vi.fn(),
      select: vi.fn(),
      single: vi.fn(),
    }
    query.update.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    query.select.mockReturnValue(query)
    query.single.mockResolvedValue({
      data: {
        id: ASSET_ID,
        approval_status: 'approved',
        curation_status: 'approved',
      },
      error: null,
    })
    serviceFrom.mockReturnValue(query)

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/brandforge/content-assets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: PROPERTY_ID,
          assetId: ASSET_ID,
          approvalStatus: 'approved',
          rightsStatus: 'generated',
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        approval_status: 'approved',
        curation_status: 'approved',
        rights_status: 'generated',
      })
    )
  })
})
