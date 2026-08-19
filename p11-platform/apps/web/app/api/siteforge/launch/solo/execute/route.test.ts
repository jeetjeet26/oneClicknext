import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { requireOwner, executeSolo } = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  executeSolo: vi.fn(),
}))

vi.mock('../../auth', () => ({
  requireLaunchManager: requireOwner,
}))
vi.mock('@/utils/siteforge/launch/solo-step-up', () => ({
  executeSoloLaunch: executeSolo,
}))

const propertyId = '11111111-1111-4111-8111-111111111111'
const releaseId = '22222222-2222-4222-8222-222222222222'
const websiteId = '44444444-4444-4444-8444-444444444444'

function request(): NextRequest {
  return new Request('http://localhost/api/siteforge/launch/solo/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      propertyId,
      websiteId,
      releaseId,
    }),
  }) as NextRequest
}

describe('SiteForge solo launch execution route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireOwner.mockResolvedValue({
      user: { id: '33333333-3333-4333-8333-333333333333' },
      response: null,
    })
    executeSolo.mockResolvedValue({
      release: { id: releaseId, state: 'promoted' },
      manualRequired: false,
    })
  })

  it('executes the exact owner launch without notes or typed confirmation', async () => {
    const { POST } = await import('./route')
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(executeSolo).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseId,
        websiteId,
        propertyId,
      })
    )
    await expect(response.json()).resolves.not.toHaveProperty('promotionToken')
  })
})
