import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createAdminClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const fromMock = vi.fn()
const rpcMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

describe('brandforge generate-next-section route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReset()
    rpcMock.mockImplementation(async (name: string, args: Record<string, unknown>) => ({error:null,data:name==='begin_brand_operation'?{state:'claimed',claimToken:'66666666-6666-4666-8666-666666666666'}:args.p_error?{state:'failed'}:{state:'applied',...(args.p_result as object)}}))
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    createAdminClientMock.mockReturnValue({
      from: fromMock,
      rpc: rpcMock,
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/brandforge/generate-next-section', {
        method: 'POST',
        body: JSON.stringify({ brandAssetId: '11111111-1111-4111-8111-111111111111', requestId: '55555555-5555-4555-8555-555555555555', revision: 1 }),
      }) as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const singleMock = vi.fn().mockResolvedValue({
      data: { property_id: 'property-1', current_step: 1 },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/brandforge/generate-next-section', {
        method: 'POST',
        body: JSON.stringify({ brandAssetId: '11111111-1111-4111-8111-111111111111', requestId: '55555555-5555-4555-8555-555555555555', revision: 1 }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('fails closed when the generation provider is not configured', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId: 'org-1' })

    const originalGeminiKey = process.env.GOOGLE_GEMINI_API_KEY
    delete process.env.GOOGLE_GEMINI_API_KEY

    const singleMock = vi.fn().mockResolvedValue({
      data: {
        property_id: 'property-1',
        current_step: 1,
        conversation_summary: { brandName: 'Sunset' },
        competitive_analysis: {},
      },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    const updateEqMock = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock })
    fromMock.mockReturnValue({ select: selectMock, update: updateMock })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/brandforge/generate-next-section', {
        method: 'POST',
        body: JSON.stringify({ brandAssetId: '11111111-1111-4111-8111-111111111111', requestId: '55555555-5555-4555-8555-555555555555', revision: 1 }),
      }) as NextRequest
    )

    process.env.GOOGLE_GEMINI_API_KEY = originalGeminiKey

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      state: 'failed',
      error: expect.stringContaining('could not be confirmed'),
    })
    expect(updateMock).not.toHaveBeenCalled()
    expect(rpcMock).toHaveBeenCalledWith('finish_brand_operation', expect.objectContaining({p_error:'generation_failed',p_updates:{}}))
  })
})
