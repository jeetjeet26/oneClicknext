import { describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('@/utils/siteforge/incidents', () => ({
  runOnePassSiteForgeRepair: vi.fn(),
}))
vi.mock('@/utils/siteforge/operations-auth', () => ({
  authorizeSiteForgeIncident: vi.fn(),
}))

describe('SiteForge incident repair route', () => {
  it('requires explicit bounded one-pass confirmation', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new Request(
        'http://localhost/api/siteforge/incidents/11111111-1111-4111-8111-111111111111/repair',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rationale: 'Operator confirmed a safe retry',
            confirmOnePass: false,
          }),
        }
      ) as NextRequest,
      {
        params: Promise.resolve({
          incidentId: '11111111-1111-4111-8111-111111111111',
        }),
      }
    )
    expect(response.status).toBe(400)
  })
})
