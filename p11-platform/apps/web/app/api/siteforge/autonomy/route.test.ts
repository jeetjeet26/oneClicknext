import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const {
  createClient,
  getPolicy,
  getUser,
  promotePolicy,
  validateAccess,
  validateManagerAccess,
} = vi.hoisted(() => ({
  createClient: vi.fn(),
  getPolicy: vi.fn(),
  getUser: vi.fn(),
  promotePolicy: vi.fn(),
  validateAccess: vi.fn(),
  validateManagerAccess: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({ createClient }))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validateAccess,
  validatePropertyManagerAccess: validateManagerAccess,
}))
vi.mock('@/utils/siteforge/autonomy-policy', () => ({
  SITEFORGE_AUTONOMY_MODES: [
    'observe_only',
    'recommend',
    'supervised',
    'bounded_auto',
  ],
  getActiveSiteForgeAutonomyMode: getPolicy,
  promoteSiteForgeAutonomyMode: promotePolicy,
}))

const propertyId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const orgId = '33333333-3333-4333-8333-333333333333'
const actionScope = 'content.publish'

function getRequest(
  query = `propertyId=${propertyId}&actionScope=${actionScope}`
): NextRequest {
  return new Request(`http://localhost/api/siteforge/autonomy?${query}`) as NextRequest
}

function postRequest(): NextRequest {
  return new Request('http://localhost/api/siteforge/autonomy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      propertyId,
      actionScope,
      requestedMode: 'observe_only',
      holdoutPercent: 0,
      limits: {},
      evidence: { evaluatedRuns: 0 },
      policyVersion: 'siteforge-autonomy-v1',
      rationale: 'Enable observation for this property scope.',
    }),
  }) as NextRequest
}

describe('SiteForge autonomy route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClient.mockResolvedValue({ auth: { getUser } })
    getUser.mockResolvedValue({ data: { user: { id: userId } } })
    validateAccess.mockResolvedValue({ authorized: true, orgId })
    validateManagerAccess.mockResolvedValue({ authorized: true, orgId })
    getPolicy.mockResolvedValue({ mode: 'observe_only', action_scope: actionScope })
    promotePolicy.mockResolvedValue({ mode: 'observe_only', action_scope: actionScope })
  })

  it('validates the property and action scope before authentication', async () => {
    const { GET } = await import('./route')
    const response = await GET(getRequest(`propertyId=${propertyId}&actionScope=x`))

    expect(response.status).toBe(400)
    expect(getUser).not.toHaveBeenCalled()
  })

  it('does not expose another tenant autonomy policy', async () => {
    validateAccess.mockResolvedValue({ authorized: false, orgId: null })
    const { GET } = await import('./route')
    const response = await GET(getRequest())

    expect(response.status).toBe(403)
    expect(validateAccess).toHaveBeenCalledWith(userId, propertyId)
    expect(getPolicy).not.toHaveBeenCalled()
  })

  it('returns the scoped policy without enabling automatic production launch', async () => {
    const { GET } = await import('./route')
    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      policy: { mode: 'observe_only' },
      automaticProductionLaunch: false,
    })
    expect(getPolicy).toHaveBeenCalledWith({ orgId, propertyId, actionScope })
  })

  it('requires property-manager access for autonomy promotion', async () => {
    validateManagerAccess.mockResolvedValue({ authorized: false, orgId: null })
    const { POST } = await import('./route')
    const response = await POST(postRequest())

    expect(response.status).toBe(403)
    expect(promotePolicy).not.toHaveBeenCalled()
  })

  it('creates a scoped policy for an authorized manager', async () => {
    const { POST } = await import('./route')
    const response = await POST(postRequest())

    expect(response.status).toBe(201)
    expect(promotePolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId,
        actionScope,
        orgId,
        actorId: userId,
      })
    )
  })
})
