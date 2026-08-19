import { describe, expect, it } from 'vitest'
import type { NextRequest } from 'next/server'

function request(): NextRequest {
  return new Request('http://localhost/api/siteforge/launch/solo/intent', {
    method: 'POST',
  }) as NextRequest
}

describe('SiteForge solo launch intent route', () => {
  it('retires approval intent in favor of one owner launch action', async () => {
    const { POST } = await import('./route')
    const response = await POST(request())
    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toMatchObject({
      code: 'SITEFORGE_OWNER_LAUNCH_ONLY',
    })
  })
})
