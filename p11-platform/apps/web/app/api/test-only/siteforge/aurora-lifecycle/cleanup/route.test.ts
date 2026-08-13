import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makeJsonRequest,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/test/route-test-helpers'

const { authGetUser, requireIdentity, validateManager } = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  requireIdentity: vi.fn(),
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
    requireAuroraLifecycleIdentity: requireIdentity,
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

function cleanupRequest(confirmation: string) {
  return makeJsonRequest(
    'http://localhost/api/test-only/siteforge/aurora-lifecycle/cleanup',
    {
      method: 'DELETE',
      body: {
        propertyId: identity.propertyId,
        websiteId: identity.websiteId,
        targetId: identity.targetId,
        ownerId: identity.ownerId,
        expiresAt: identity.expiresAt,
        confirmation,
      },
    }
  )
}

describe('Aurora lifecycle cleanup route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireIdentity.mockReturnValue(identity)
    mockAuthenticatedUser(authGetUser, 'manager-1')
    validateManager.mockResolvedValue({ authorized: true })
  })

  it('rejects cleanup without the exact destructive confirmation phrase', async () => {
    const { DELETE } = await import('./route')
    const response = await DELETE(cleanupRequest('DELETE_AURORA'))
    expect(response.status).toBe(400)
    expect(validateManager).not.toHaveBeenCalled()
  })

  it('requires an authenticated manager before inspecting owned resources', async () => {
    mockUnauthenticatedUser(authGetUser)
    const { DELETE } = await import('./route')
    const response = await DELETE(
      cleanupRequest('DELETE_OWNED_AURORA_RESOURCES')
    )
    expect(response.status).toBe(401)
    expect(validateManager).not.toHaveBeenCalled()

    mockAuthenticatedUser(authGetUser, 'manager-1')
    validateManager.mockResolvedValue({ authorized: false })
    const forbidden = await DELETE(
      cleanupRequest('DELETE_OWNED_AURORA_RESOURCES')
    )
    expect(forbidden.status).toBe(403)
  })

  it('deletes deployments linked to owned artifacts before artifact removal', async () => {
    const removeDeployments = vi.fn().mockResolvedValue({ error: null })
    const { deleteOwnedArtifactDeployments } = await import('./route')

    await deleteOwnedArtifactDeployments(
      removeDeployments,
      identity.websiteId,
      [
        '66666666-6666-4666-8666-666666666666',
        '77777777-7777-4777-8777-777777777777',
      ]
    )

    expect(removeDeployments).toHaveBeenCalledWith(
      [
        '66666666-6666-4666-8666-666666666666',
        '77777777-7777-4777-8777-777777777777',
      ],
      identity.websiteId
    )
  })

  it('removes only overlays unreferenced by retained artifacts', async () => {
    const { selectUnreferencedAuroraOverlays } = await import('./route')

    expect(
      selectUnreferencedAuroraOverlays(
        [
          {
            id: '66666666-6666-4666-8666-666666666666',
            storagePath: 'overlays/site/first.zip',
          },
          {
            id: '77777777-7777-4777-8777-777777777777',
            storagePath: 'overlays/site/second.zip',
          },
        ],
        [
          {
            artifactId: '88888888-8888-4888-888888888888',
            overlayId: '66666666-6666-4666-8666-666666666666',
          },
          {
            artifactId: '99999999-9999-4999-899999999999',
            overlayId: '77777777-7777-4777-8777-777777777777',
          },
        ],
        ['88888888-8888-4888-888888888888']
      )
    ).toEqual([
      {
        id: '66666666-6666-4666-8666-666666666666',
        storagePath: 'overlays/site/first.zip',
      },
    ])
  })
})
