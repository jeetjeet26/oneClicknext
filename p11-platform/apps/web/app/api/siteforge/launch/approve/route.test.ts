import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { approveRelease, requireManager } = vi.hoisted(() => ({
  approveRelease: vi.fn(),
  requireManager: vi.fn(),
}))

vi.mock('../auth', () => ({ requireLaunchManager: requireManager }))
vi.mock('@/utils/siteforge/launch/service', () => ({
  approveLaunchRelease: approveRelease,
}))

const propertyId = '11111111-1111-4111-8111-111111111111'
const releaseId = '22222222-2222-4222-8222-222222222222'
const artifactId = '33333333-3333-4333-8333-333333333333'
const rollbackArtifactId = '44444444-4444-4444-8444-444444444444'
const userId = '55555555-5555-4555-8555-555555555555'

function request(
  overrides: Record<string, unknown> = {},
  omit: string[] = []
): NextRequest {
  const body: Record<string, unknown> = {
    propertyId,
    releaseId,
    artifactId,
    contentHash: 'a'.repeat(64),
    rollbackArtifactId,
    rollbackContentHash: 'b'.repeat(64),
    rationale: 'Release evidence reviewed by the launch manager.',
    legalSnapshot: { confirmed: true, source: 'approved-legal-config' },
    expiresAt: '2026-08-04T12:00:00.000Z',
    ...overrides,
  }
  for (const key of omit) delete body[key]
  return new Request('http://localhost/api/siteforge/launch/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

describe('SiteForge launch approval route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireManager.mockResolvedValue({ user: { id: userId }, response: null })
    approveRelease.mockResolvedValue({
      release: { id: releaseId, state: 'approved' },
      promotionToken: 'one-time-token',
    })
  })

  it('rejects incomplete approval evidence before authorization', async () => {
    const { POST } = await import('./route')
    const response = await POST(request({ legalSnapshot: { confirmed: false } }))

    expect(response.status).toBe(400)
    expect(requireManager).not.toHaveBeenCalled()
    expect(approveRelease).not.toHaveBeenCalled()
  })

  it('requires launch-manager access for the requested property', async () => {
    requireManager.mockResolvedValue({
      user: null,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    })
    const { POST } = await import('./route')
    const response = await POST(request())

    expect(response.status).toBe(403)
    expect(requireManager).toHaveBeenCalledWith(
      propertyId,
      expect.any(Request)
    )
    expect(approveRelease).not.toHaveBeenCalled()
  })

  it('approves the exact release evidence as the authenticated manager', async () => {
    const { POST } = await import('./route')
    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      release: { id: releaseId, state: 'approved' },
      promotionToken: 'one-time-token',
      finalLaunchHumanOwned: true,
    })
    expect(approveRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId,
        releaseId,
        artifactId,
        rollbackArtifactId,
        approvedBy: userId,
      })
    )
  })

  it('accepts a first-launch approval with acknowledgment and no rollback identity', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      request({ firstLaunchAcknowledged: true }, [
        'rollbackArtifactId',
        'rollbackContentHash',
      ])
    )

    expect(response.status).toBe(200)
    expect(approveRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseId,
        rollbackArtifactId: null,
        rollbackContentHash: null,
        firstLaunchAcknowledged: true,
      })
    )
  })

  it('rejects a partial rollback identity', async () => {
    const { POST } = await import('./route')
    const response = await POST(request({}, ['rollbackContentHash']))

    expect(response.status).toBe(400)
    expect(approveRelease).not.toHaveBeenCalled()
  })
})
