import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const {
  createClient,
  createServiceClient,
  eqCall,
  getUser,
  serviceFrom,
  upsertCall,
  validateManagerAccess,
} = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  eqCall: vi.fn(),
  getUser: vi.fn(),
  serviceFrom: vi.fn(),
  upsertCall: vi.fn(),
  validateManagerAccess: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({ createClient }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient }))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyManagerAccess: validateManagerAccess,
}))
vi.mock('@/utils/siteforge/failure-injection', () => ({
  siteForgeFailureInjectionEnabled: () => true,
}))

const propertyId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const orgId = '33333333-3333-4333-8333-333333333333'
const failpoint = 'deployment.before_publish'
const scopeKey = 'website:44444444-4444-4444-8444-444444444444'

function query() {
  const builder: Record<string, ReturnType<typeof vi.fn>> & { error?: null } = {}
  builder.upsert = vi.fn((value: unknown) => {
    upsertCall(value)
    return builder
  })
  builder.select = vi.fn(() => builder)
  builder.single = vi.fn(async () => ({
    data: { id: '55555555-5555-4555-8555-555555555555', failpoint, scope_key: scopeKey },
    error: null,
  }))
  builder.delete = vi.fn(() => builder)
  builder.eq = vi.fn((column: string, value: unknown) => {
    eqCall(column, value)
    return builder
  })
  return builder
}

function postRequest(expiresAt = new Date(Date.now() + 30 * 60_000).toISOString()): NextRequest {
  return new Request('http://localhost/api/siteforge/failure-injections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      propertyId,
      failpoint,
      scopeKey,
      remainingHits: 2,
      expiresAt,
    }),
  }) as NextRequest
}

function deleteRequest(): NextRequest {
  const params = new URLSearchParams({ propertyId, failpoint, scopeKey })
  return new Request(
    `http://localhost/api/siteforge/failure-injections?${params}`,
    { method: 'DELETE' }
  ) as NextRequest
}

describe('SiteForge failure injection route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClient.mockResolvedValue({ auth: { getUser } })
    createServiceClient.mockReturnValue({ from: serviceFrom })
    serviceFrom.mockImplementation(() => query())
    getUser.mockResolvedValue({ data: { user: { id: userId } } })
    validateManagerAccess.mockResolvedValue({ authorized: true, orgId })
  })

  it('rejects an expired injection before authentication', async () => {
    const { POST } = await import('./route')
    const response = await POST(postRequest(new Date(Date.now() - 1_000).toISOString()))

    expect(response.status).toBe(400)
    expect(getUser).not.toHaveBeenCalled()
  })

  it('does not create injections without property-manager access', async () => {
    validateManagerAccess.mockResolvedValue({ authorized: false, orgId: null })
    const { POST } = await import('./route')
    const response = await POST(postRequest())

    expect(response.status).toBe(403)
    expect(upsertCall).not.toHaveBeenCalled()
  })

  it('stores a bounded injection under the authorized tenant', async () => {
    const { POST } = await import('./route')
    const response = await POST(postRequest())

    expect(response.status).toBe(201)
    expect(upsertCall).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: orgId,
        failpoint,
        scope_key: scopeKey,
        remaining_hits: 2,
        created_by: userId,
      })
    )
  })

  it('removes only the authorized tenant injection', async () => {
    const { DELETE } = await import('./route')
    const response = await DELETE(deleteRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ removed: true })
    expect(eqCall).toHaveBeenCalledWith('org_id', orgId)
    expect(eqCall).toHaveBeenCalledWith('failpoint', failpoint)
    expect(eqCall).toHaveBeenCalledWith('scope_key', scopeKey)
  })
})
