import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authGetUser = vi.fn()
const validateAccess = vi.fn()
const buildSnapshot = vi.fn()
const approveSnapshot = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: authGetUser } })),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validateAccess,
}))
vi.mock('@/utils/onboarding/repository', () => ({
  buildOnboardingSnapshot: buildSnapshot,
  approveOnboardingSnapshot: approveSnapshot,
}))
vi.mock('@/utils/services/request-context', () => ({
  createRequestContext: () => ({
    responseHeaders: {},
    logStart: vi.fn(),
    logSuccess: vi.fn(),
    logError: vi.fn(),
  }),
}))

const propertyId = '11111111-1111-4111-8111-111111111111'
const snapshotId = '22222222-2222-4222-8222-222222222222'

describe('POST /api/onboarding/readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authGetUser.mockResolvedValue({
      data: { user: { id: '33333333-3333-4333-8333-333333333333' } },
      error: null,
    })
    validateAccess.mockResolvedValue({ authorized: true, orgId: 'org-1' })
    approveSnapshot.mockResolvedValue({
      id: snapshotId,
      status: 'approved',
      unresolved_conflicts: [],
    })
  })

  it('approves a fully ready snapshot as part of the readiness check', async () => {
    buildSnapshot.mockResolvedValue({ id: snapshotId, status: 'ready' })
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/onboarding/readiness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, enabledCapabilities: [] }),
      })
    )

    expect(response.status).toBe(201)
    expect(approveSnapshot).toHaveBeenCalledWith({
      orgId: 'org-1',
      propertyId,
      snapshotId,
      userId: '33333333-3333-4333-8333-333333333333',
    })
    await expect(response.json()).resolves.toMatchObject({
      snapshot: { id: snapshotId, status: 'approved' },
    })
  })

  it('leaves warning snapshots for explicit manager override', async () => {
    buildSnapshot.mockResolvedValue({ id: snapshotId, status: 'needs_review' })
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/onboarding/readiness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, enabledCapabilities: [] }),
      })
    )

    expect(response.status).toBe(201)
    expect(approveSnapshot).not.toHaveBeenCalled()
  })
})
