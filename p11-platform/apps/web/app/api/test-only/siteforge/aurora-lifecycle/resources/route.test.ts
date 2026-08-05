import { describe, expect, it, vi } from 'vitest'
import { makeJsonRequest } from '@/test/route-test-helpers'

const { requireIdentity } = vi.hoisted(() => ({
  requireIdentity: vi.fn(() => ({
    propertyId: '11111111-1111-4111-8111-111111111111',
    websiteId: '22222222-2222-4222-8222-222222222222',
    targetId: '33333333-3333-4333-8333-333333333333',
    rolloutAssignmentId: '44444444-4444-4444-8444-444444444444',
    ownerId: '55555555-5555-4555-8555-555555555555',
    expiresAt: '2026-08-05T08:00:00.000Z',
  })),
}))

vi.mock('@/utils/siteforge/testing/aurora-lifecycle-control', async () => {
  const actual = await vi.importActual<
    typeof import('@/utils/siteforge/testing/aurora-lifecycle-control')
  >('@/utils/siteforge/testing/aurora-lifecycle-control')
  return { ...actual, requireAuroraLifecycleIdentity: requireIdentity }
})

describe('Aurora lifecycle resource mutation contract', () => {
  it('rejects caller-supplied storage and provider identities', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest(
        'http://localhost/api/test-only/siteforge/aurora-lifecycle/resources',
        {
          body: {
            operation: 'install_verified_base_theme',
            propertyId: '11111111-1111-4111-8111-111111111111',
            websiteId: '22222222-2222-4222-8222-222222222222',
            packageSha256: 'a'.repeat(64),
            storagePath: 'caller-controlled/theme.zip',
            applicationId: 'caller-controlled-application',
          },
        }
      )
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      code: 'invalid_request',
    })
  })
})
