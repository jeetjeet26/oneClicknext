import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authGetUser = vi.fn()
const validateManagerAccess = vi.fn()
const approveSnapshot = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: authGetUser } })),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyManagerAccess: validateManagerAccess,
}))
vi.mock('@/utils/onboarding/repository', () => ({
  approveOnboardingSnapshot: approveSnapshot,
}))
vi.mock('@/utils/services/request-context', () => ({
  createRequestContext: () => ({
    responseHeaders: { 'X-Request-Id': 'readiness-approval-request' },
    logStart: vi.fn(),
    logSuccess: vi.fn(),
    logError: vi.fn(),
  }),
}))

const PROPERTY_ID = '33333333-3333-4333-8333-333333333333'
const SNAPSHOT_ID = '44444444-4444-4444-8444-444444444444'

describe('POST /api/onboarding/readiness/[snapshotId]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authGetUser.mockResolvedValue({
      data: { user: { id: 'manager-1' } },
      error: null,
    })
    validateManagerAccess.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    approveSnapshot.mockResolvedValue({
      id: SNAPSHOT_ID,
      status: 'approved',
      unresolved_conflicts: [],
    })
  })

  it('passes an explicit manager override and rationale to the audited approval', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/onboarding/readiness/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: PROPERTY_ID,
          rationale: 'Manager accepts the operational warning.',
          allowManagerOverride: true,
        }),
      }),
      { params: Promise.resolve({ snapshotId: SNAPSHOT_ID }) }
    )

    expect(response.status).toBe(200)
    expect(validateManagerAccess).toHaveBeenCalledWith('manager-1', PROPERTY_ID)
    expect(approveSnapshot).toHaveBeenCalledWith({
      orgId: 'org-1',
      propertyId: PROPERTY_ID,
      snapshotId: SNAPSHOT_ID,
      userId: 'manager-1',
      rationale: 'Manager accepts the operational warning.',
      allowManagerOverride: true,
    })
  })

  it('rejects users without manager access', async () => {
    validateManagerAccess.mockResolvedValue({ authorized: false })
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/onboarding/readiness/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: PROPERTY_ID,
          rationale: 'Attempted override without manager access.',
          allowManagerOverride: true,
        }),
      }),
      { params: Promise.resolve({ snapshotId: SNAPSHOT_ID }) }
    )

    expect(response.status).toBe(403)
    expect(approveSnapshot).not.toHaveBeenCalled()
  })
})
