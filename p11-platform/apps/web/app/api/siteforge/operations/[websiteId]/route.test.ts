import { describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('@/utils/siteforge/operations-auth', () => ({
  authorizeSiteForgeWebsite: vi.fn(),
}))

describe('SiteForge operations route', () => {
  it('rejects malformed restore requests before authorization', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new Request(
        'http://localhost/api/siteforge/operations/11111111-1111-4111-8111-111111111111',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'execute_restore',
            rationale: 'Attempt to bypass supervised restore',
          }),
        }
      ) as NextRequest,
      {
        params: Promise.resolve({
          websiteId: '11111111-1111-4111-8111-111111111111',
        }),
      }
    )
    expect(response.status).toBe(400)
  })
})
