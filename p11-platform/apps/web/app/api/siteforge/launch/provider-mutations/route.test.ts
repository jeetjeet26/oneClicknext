import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { SiteForgeLaunchError } from '@/utils/siteforge/launch/repository'

const { requireManager, executeMutation } = vi.hoisted(() => ({
  requireManager: vi.fn(),
  executeMutation: vi.fn(),
}))

vi.mock('../auth', () => ({ requireLaunchManager: requireManager }))
vi.mock('@/utils/siteforge/launch/service', () => ({
  executeLaunchProviderMutation: executeMutation,
}))

const propertyId = '11111111-1111-4111-8111-111111111111'
const releaseId = '22222222-2222-4222-8222-222222222222'

function request(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/siteforge/launch/provider-mutations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

describe('SiteForge launch provider mutation route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireManager.mockResolvedValue({
      user: { id: '33333333-3333-4333-8333-333333333333' },
      response: null,
    })
  })

  it('rejects unknown mutations before touching the provider', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      request({ propertyId, releaseId, mutation: 'delete_everything' })
    )
    expect(response.status).toBe(400)
    expect(executeMutation).not.toHaveBeenCalled()
  })

  it('requires launch manager access', async () => {
    requireManager.mockResolvedValue({
      user: null,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
      }),
    })
    const { POST } = await import('./route')
    const response = await POST(
      request({ propertyId, releaseId, mutation: 'backup' })
    )
    expect(response.status).toBe(403)
    expect(executeMutation).not.toHaveBeenCalled()
  })

  it('returns the checkpointed provider identity for a backup', async () => {
    executeMutation.mockResolvedValue({
      mutation: 'backup',
      operationId: 'op-1',
      backupId: '2026-08-07T08:00:00',
      idempotent: false,
    })
    const { POST } = await import('./route')
    const response = await POST(
      request({ propertyId, releaseId, mutation: 'backup' })
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      mutation: 'backup',
      operationId: 'op-1',
      backupId: '2026-08-07T08:00:00',
    })
    expect(executeMutation).toHaveBeenCalledWith(
      expect.objectContaining({ releaseId, propertyId, mutation: 'backup' })
    )
  })

  it('propagates deterministic launch errors without a 500', async () => {
    executeMutation.mockRejectedValue(
      new SiteForgeLaunchError(
        'A staging push-to-live cannot start from certified',
        409
      )
    )
    const { POST } = await import('./route')
    const response = await POST(
      request({ propertyId, releaseId, mutation: 'promotion' })
    )
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'A staging push-to-live cannot start from certified',
    })
  })
})
