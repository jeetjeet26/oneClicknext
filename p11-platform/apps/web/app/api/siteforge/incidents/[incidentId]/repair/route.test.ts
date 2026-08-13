import { describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { recheck, repair, authorizeIncident } = vi.hoisted(() => ({
  recheck: vi.fn(),
  repair: vi.fn(),
  authorizeIncident: vi.fn(),
}))

vi.mock('@/utils/siteforge/incidents', () => ({
  runOnePassSiteForgeRepair: repair,
  runSiteForgeIncidentRecheck: recheck,
  SITEFORGE_SAFE_REPAIR_HANDLERS: ['resolve_after_verified_recheck'],
}))
vi.mock('@/utils/siteforge/operations-auth', () => ({
  authorizeSiteForgeIncident: authorizeIncident,
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
            operation: 'recheck',
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

  it('keeps rechecks distinct from safe repairs', async () => {
    authorizeIncident.mockResolvedValue({ user: { id: 'operator-1' } })
    recheck.mockResolvedValue({
      operation: 'recheck',
      productionMutated: false,
      verified: true,
      repaired: false,
    })
    const { POST } = await import('./route')
    const response = await POST(
      new Request(
        'http://localhost/api/siteforge/incidents/11111111-1111-4111-8111-111111111111/repair',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'recheck',
            rationale: 'Operator requested an evidence-only production recheck.',
            confirmOnePass: true,
          }),
        }
      ) as NextRequest,
      {
        params: Promise.resolve({
          incidentId: '11111111-1111-4111-8111-111111111111',
        }),
      }
    )
    expect(response.status).toBe(200)
    expect(recheck).toHaveBeenCalledOnce()
    expect(repair).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      operation: 'recheck',
      productionMutated: false,
    })
  })
})
