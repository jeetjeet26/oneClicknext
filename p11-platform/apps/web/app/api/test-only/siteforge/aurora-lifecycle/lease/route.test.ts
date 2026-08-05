import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makeJsonRequest,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/test/route-test-helpers'

const {
  acquireLease,
  authGetUser,
  releaseLease,
  requireIdentity,
  transitionLease,
  validateManager,
} = vi.hoisted(() => ({
  acquireLease: vi.fn(),
  authGetUser: vi.fn(),
  releaseLease: vi.fn(),
  requireIdentity: vi.fn(),
  transitionLease: vi.fn(),
  validateManager: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: authGetUser },
  })),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyManagerAccess: validateManager,
}))
vi.mock('@/utils/siteforge/testing/aurora-lifecycle-control', async () => {
  const actual = await vi.importActual<
    typeof import('@/utils/siteforge/testing/aurora-lifecycle-control')
  >('@/utils/siteforge/testing/aurora-lifecycle-control')
  return {
    ...actual,
    acquireOrRenewAuroraLifecycleLease: acquireLease,
    releaseAuroraLifecycleLease: releaseLease,
    requireAuroraLifecycleIdentity: requireIdentity,
    transitionAuroraLifecycleToMutation: transitionLease,
  }
})

const identity = {
  propertyId: '11111111-1111-4111-8111-111111111111',
  websiteId: '22222222-2222-4222-8222-222222222222',
  targetId: '33333333-3333-4333-8333-333333333333',
  rolloutAssignmentId: '44444444-4444-4444-8444-444444444444',
  ownerId: '55555555-5555-4555-8555-555555555555',
  expiresAt: '2026-08-05T08:00:00.000Z',
}

function request(
  operation: 'acquire' | 'renew' | 'activate_mutation' = 'acquire'
) {
  return makeJsonRequest(
    'http://localhost/api/test-only/siteforge/aurora-lifecycle/lease',
    { body: { operation, ...identity } }
  )
}

describe('Aurora lifecycle lease route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireIdentity.mockReturnValue(identity)
    mockAuthenticatedUser(authGetUser, 'manager-1')
    validateManager.mockResolvedValue({ authorized: true })
    acquireLease.mockResolvedValue({
      id: '66666666-6666-4666-8666-666666666666',
      lease_owner: identity.ownerId,
      lease_expires_at: identity.expiresAt,
      lifecycle_status: 'running',
    })
    transitionLease.mockResolvedValue({
      id: '66666666-6666-4666-8666-666666666666',
      lease_owner: identity.ownerId,
      lease_expires_at: identity.expiresAt,
      lifecycle_status: 'running',
      output: { phase: 'mutation' },
    })
  })

  it('requires an authenticated manager from the exact property tenant', async () => {
    mockUnauthenticatedUser(authGetUser)
    const { POST } = await import('./route')
    const response = await POST(request())
    expect(response.status).toBe(401)

    mockAuthenticatedUser(authGetUser, 'manager-1')
    validateManager.mockResolvedValue({ authorized: false })
    const forbidden = await POST(request())
    expect(forbidden.status).toBe(403)
    expect(acquireLease).not.toHaveBeenCalled()
  })

  it.each([
    ['control_disabled', 404],
    ['invalid_bearer', 401],
    ['lease_expired', 409],
    ['lease_owner_conflict', 409],
  ])('returns deterministic %s failures', async (code, status) => {
    const { AuroraLifecycleControlError } = await import(
      '@/utils/siteforge/testing/aurora-lifecycle-control'
    )
    requireIdentity.mockImplementationOnce(() => {
      throw new AuroraLifecycleControlError(code, status, code)
    })
    const { POST } = await import('./route')
    const response = await POST(request())
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toMatchObject({ code })
  })

  it('reconciles an identical retry to the same owned lease', async () => {
    const { POST } = await import('./route')
    const first = await POST(request())
    const retry = await POST(request())
    expect(first.status).toBe(200)
    expect(retry.status).toBe(200)
    expect(acquireLease).toHaveBeenCalledTimes(2)
    await expect(retry.json()).resolves.toMatchObject({
      lease: { ownerId: identity.ownerId, status: 'running' },
    })
  })

  it('activates mutation only through the prerequisite transition', async () => {
    const { POST } = await import('./route')
    const response = await POST(request('activate_mutation'))
    expect(response.status).toBe(200)
    expect(transitionLease).toHaveBeenCalledWith(identity)
    expect(acquireLease).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      lease: { phase: 'mutation' },
    })
  })

  it('releases only with the exact confirmation', async () => {
    const { DELETE } = await import('./route')
    const rejected = await DELETE(
      makeJsonRequest(
        'http://localhost/api/test-only/siteforge/aurora-lifecycle/lease',
        { method: 'DELETE', body: { confirmation: 'release' } }
      )
    )
    expect(rejected.status).toBe(400)
    expect(releaseLease).not.toHaveBeenCalled()

    const released = await DELETE(
      makeJsonRequest(
        'http://localhost/api/test-only/siteforge/aurora-lifecycle/lease',
        {
          method: 'DELETE',
          body: { confirmation: 'RELEASE_OWNED_AURORA_LEASE' },
        }
      )
    )
    expect(released.status).toBe(200)
    expect(releaseLease).toHaveBeenCalledWith(identity)
  })
})
