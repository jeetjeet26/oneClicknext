import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { requireManager, prepareRelease } = vi.hoisted(() => ({
  requireManager: vi.fn(),
  prepareRelease: vi.fn(),
}))

vi.mock('../auth', () => ({ requireLaunchManager: requireManager }))
vi.mock('@/utils/siteforge/launch/repository', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/utils/siteforge/launch/repository')>()
  return { ...actual, prepareLaunchRelease: prepareRelease }
})

const propertyId = '11111111-1111-4111-8111-111111111111'
const websiteId = '22222222-2222-4222-8222-222222222222'
const artifactId = '33333333-3333-4333-8333-333333333333'
const rollbackArtifactId = '44444444-4444-4444-8444-444444444444'

function request(): NextRequest {
  return new Request('http://localhost/api/siteforge/launch/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      propertyId,
      websiteId,
      artifactId,
      contentHash: 'a'.repeat(64),
      rollbackArtifactId,
      rollbackContentHash: 'b'.repeat(64),
    }),
  }) as NextRequest
}

describe('SiteForge launch preparation route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireManager.mockResolvedValue({
      user: { id: '55555555-5555-4555-8555-555555555555' },
      response: null,
    })
    prepareRelease.mockResolvedValue({
      id: '66666666-6666-4666-8666-666666666666',
      state: 'certified',
    })
  })

  it('requires manager authorization before preparing a release', async () => {
    requireManager.mockResolvedValue({
      user: null,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    })
    const { POST } = await import('./route')
    const response = await POST(request())
    expect(response.status).toBe(403)
    expect(prepareRelease).not.toHaveBeenCalled()
  })

  it('pins both launch and rollback artifact identities', async () => {
    const { POST } = await import('./route')
    const response = await POST(request())
    expect(response.status).toBe(201)
    expect(prepareRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        websiteId,
        artifactId,
        contentHash: 'a'.repeat(64),
        rollbackArtifactId,
        rollbackContentHash: 'b'.repeat(64),
      })
    )
  })
})
