import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))
import { runSiteForgeHealth, SITEFORGE_HEALTH_CHECKS, type SiteForgeHealthProbes } from './production-health'

describe('monitoring outbound request boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects a host that changes to a private address after the initial check', async () => {
    mocks.lookup.mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }])
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    const nativeFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>internal</html>'))
    const service = {
      from: vi.fn(() => ({ insert: () => ({ select: () => ({ single: async () => ({
        data: { id: 'fixture-run', started_at: '2026-11-03T00:00:00Z' }, error: null,
      }) }) }) })),
      rpc: vi.fn().mockResolvedValue({ data: { incidentChanges: [], alertIncidentIds: [], superseded: false }, error: null }),
    }
    const probes = Object.fromEntries(SITEFORGE_HEALTH_CHECKS.map(check => [check,
      async () => ({ passed: true, state: 'healthy', summary: 'Fixture' }),
    ])) as unknown as SiteForgeHealthProbes
    probes.reachability = async context => {
      await context.document()
      return { passed: true, state: 'healthy', summary: 'Fetched' }
    }
    try {
      const result = await runSiteForgeHealth({
        orgId: 'fixture-org', propertyId: 'fixture-property', websiteId: 'fixture-site',
        artifactId: null, contentHash: null, url: 'https://attacker.example', purpose: 'testbed',
      }, { trigger: 'manual', service: service as never, probes })
      expect(nativeFetch).not.toHaveBeenCalled()
      expect(result.checks.reachability).toMatchObject({ passed: false, state: 'failed' })
    } finally {
      nativeFetch.mockRestore()
    }
  })
})
