import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const fromMock = vi.fn()
const startMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))
vi.mock('workflow/api', () => ({
  start: startMock,
}))
vi.mock('@/utils/services/request-context', () => ({
  createRequestContext: () => ({
    responseHeaders: { 'x-request-id': 'request-1' },
    logStart: vi.fn(),
    logSuccess: vi.fn(),
    logError: vi.fn(),
  }),
}))

const propertyId = '10000000-0000-4000-8000-000000000001'
const brandAssetId = '20000000-0000-4000-8000-000000000001'
const orgId = '30000000-0000-4000-8000-000000000001'
const userId = '40000000-0000-4000-8000-000000000001'

describe('BrandForge workflow route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })
  })

  it('rejects unauthenticated workflow starts', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost/api/brandforge/workflow', {
      method: 'POST',
      body: JSON.stringify({}),
    }) as NextRequest)

    expect(response.status).toBe(401)
    expect(startMock).not.toHaveBeenCalled()
  })

  it('starts one durable generated flow for a for-sale community', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId,
    })
    startMock.mockResolvedValue({ runId: 'wrun_123' })

    const propertySingle = vi.fn().mockResolvedValue({
      data: { id: propertyId, org_id: orgId },
      error: null,
    })
    const propertyEqOrg = vi.fn().mockReturnValue({ single: propertySingle })
    const propertyEqId = vi.fn().mockReturnValue({ eq: propertyEqOrg })
    const propertySelect = vi.fn().mockReturnValue({ eq: propertyEqId })

    const brandSingle = vi.fn().mockResolvedValue({
      data: { id: brandAssetId },
      error: null,
    })
    const brandEqProperty = vi.fn().mockReturnValue({ single: brandSingle })
    const brandEqId = vi.fn().mockReturnValue({ eq: brandEqProperty })
    const brandSelect = vi.fn().mockReturnValue({ eq: brandEqId })
    const updateEqProperty = vi.fn().mockResolvedValue({ error: null })
    const updateEqId = vi.fn().mockReturnValue({ eq: updateEqProperty })
    const update = vi.fn().mockReturnValue({ eq: updateEqId })

    fromMock.mockImplementation((table: string) => {
      if (table === 'properties') return { select: propertySelect }
      if (table === 'property_brand_assets') {
        return { select: brandSelect, update }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost/api/brandforge/workflow', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'generated',
        propertyId,
        brandAssetId,
        vertical: 'for_sale_community',
        creativeBrief: {
          brandName: 'Juniper Row',
          vision: 'A connected neighborhood',
        },
      }),
    }) as NextRequest)

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({
      brandAssetId,
      runId: 'wrun_123',
      status: 'generating',
      mode: 'generated',
      vertical: 'for_sale_community',
    })
    expect(startMock).toHaveBeenCalledOnce()
    expect(startMock.mock.calls[0]?.[1]?.[0]).toMatchObject({
      mode: 'generated',
      brandAssetId,
      propertyId,
      orgId,
      requestedBy: userId,
      vertical: 'for_sale_community',
    })
  })
})
