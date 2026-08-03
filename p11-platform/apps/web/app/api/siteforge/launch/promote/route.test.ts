import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { requireManager, promoteRelease } = vi.hoisted(() => ({
  requireManager: vi.fn(),
  promoteRelease: vi.fn(),
}))

vi.mock('../auth', () => ({ requireLaunchManager: requireManager }))
vi.mock('@/utils/siteforge/launch/service', () => ({
  promoteLaunchRelease: promoteRelease,
}))

const propertyId = '11111111-1111-4111-8111-111111111111'
const releaseId = '22222222-2222-4222-8222-222222222222'

function request(manual = false): NextRequest {
  return new Request('http://localhost/api/siteforge/launch/promote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      propertyId,
      releaseId,
      promotionToken: 'signed.'.padEnd(80, 'a'),
      ...(manual ? { manualConfirmation: { operationId: 'dashboard-operation-1' } } : {}),
    }),
  }) as NextRequest
}

describe('SiteForge launch promotion route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireManager.mockResolvedValue({
      user: { id: '33333333-3333-4333-8333-333333333333' },
      response: null,
    })
    promoteRelease.mockResolvedValue({
      release: { id: releaseId, state: 'backed_up' },
      manualRequired: true,
      dashboardAction: 'Confirm in Cloudways.',
    })
  })

  it('reports unsupported provider promotion without claiming launch success', async () => {
    const { POST } = await import('./route')
    const response = await POST(request())
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      manualRequired: true,
      release: { state: 'backed_up' },
    })
  })

  it('passes an explicit dashboard confirmation to the launch service', async () => {
    promoteRelease.mockResolvedValue({
      release: { id: releaseId, state: 'promoted' },
      manualRequired: false,
    })
    const { POST } = await import('./route')
    const response = await POST(request(true))
    expect(response.status).toBe(200)
    expect(promoteRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseId,
        manualConfirmation: { operationId: 'dashboard-operation-1' },
      })
    )
  })
})
