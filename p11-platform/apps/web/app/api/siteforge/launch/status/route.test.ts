import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { getStatus, requireManager } = vi.hoisted(() => ({
  getStatus: vi.fn(),
  requireManager: vi.fn(),
}))

vi.mock('../auth', () => ({ requireLaunchManager: requireManager }))
vi.mock('@/utils/siteforge/launch/repository', () => ({
  getLaunchStatus: getStatus,
  SiteForgeLaunchError: class SiteForgeLaunchError extends Error {
    statusCode = 409
  },
}))

const propertyId = '11111111-1111-4111-8111-111111111111'
const releaseId = '22222222-2222-4222-8222-222222222222'

function request(query = `propertyId=${propertyId}&releaseId=${releaseId}`): NextRequest {
  return new Request(
    `http://localhost/api/siteforge/launch/status?${query}`
  ) as NextRequest
}

describe('SiteForge launch status route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireManager.mockResolvedValue({
      user: { id: '33333333-3333-4333-8333-333333333333' },
      response: null,
    })
    getStatus.mockResolvedValue({
      release: { id: releaseId, state: 'approved' },
      events: [],
    })
  })

  it('requires a property and release or website identifier', async () => {
    const { GET } = await import('./route')
    const response = await GET(request(`propertyId=${propertyId}`))

    expect(response.status).toBe(400)
    expect(requireManager).not.toHaveBeenCalled()
  })

  it('does not load another tenant release without manager access', async () => {
    requireManager.mockResolvedValue({
      user: null,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    })
    const { GET } = await import('./route')
    const response = await GET(request())

    expect(response.status).toBe(403)
    expect(requireManager).toHaveBeenCalledWith(propertyId)
    expect(getStatus).not.toHaveBeenCalled()
  })

  it('returns launch status for an authorized property', async () => {
    const { GET } = await import('./route')
    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      release: { id: releaseId, state: 'approved' },
    })
    expect(getStatus).toHaveBeenCalledWith({ propertyId, releaseId })
  })
})
