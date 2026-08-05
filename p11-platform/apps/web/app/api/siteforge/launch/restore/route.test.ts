import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { markReady, requireManager, restoreRelease } = vi.hoisted(() => ({
  markReady: vi.fn(),
  requireManager: vi.fn(),
  restoreRelease: vi.fn(),
}))

vi.mock('../auth', () => ({ requireLaunchManager: requireManager }))
vi.mock('@/utils/siteforge/launch/service', () => ({
  restoreLaunchRelease: restoreRelease,
}))
vi.mock('@/utils/siteforge/restore-drill-runner', () => ({
  markRestoreDrillsReadyForVerification: markReady,
}))

const propertyId = '11111111-1111-4111-8111-111111111111'
const releaseId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

function request(overrides: Record<string, unknown> = {}): NextRequest {
  return new Request('http://localhost/api/siteforge/launch/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      propertyId,
      releaseId,
      rationale: 'Restore the last verified release after the incident.',
      manualConfirmation: { operationId: 'cloudways-operation-42' },
      ...overrides,
    }),
  }) as NextRequest
}

describe('SiteForge launch restore route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireManager.mockResolvedValue({ user: { id: userId }, response: null })
    restoreRelease.mockResolvedValue({
      release: { id: releaseId, state: 'restored' },
      manualRequired: false,
    })
    markReady.mockResolvedValue(undefined)
  })

  it('validates the release identity before authorization', async () => {
    const { POST } = await import('./route')
    const response = await POST(request({ releaseId: 'not-a-uuid' }))

    expect(response.status).toBe(400)
    expect(requireManager).not.toHaveBeenCalled()
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
    expect(restoreRelease).not.toHaveBeenCalled()
  })

  it('restores an authorized release and advances restore-drill verification', async () => {
    const { POST } = await import('./route')
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(restoreRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId,
        releaseId,
        actorId: userId,
        manualConfirmation: { operationId: 'cloudways-operation-42' },
      })
    )
    expect(markReady).toHaveBeenCalledWith(releaseId, 'cloudways-operation-42')
  })
})
