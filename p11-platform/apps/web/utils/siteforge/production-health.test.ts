import { describe, expect, it, vi } from 'vitest'
import {
  createDefaultSiteForgeHealthProbes,
  SITEFORGE_HEALTH_CHECKS,
} from './production-health'

describe('SiteForge production health probes', () => {
  it('defines every production safety check', () => {
    expect(SITEFORGE_HEALTH_CHECKS).toEqual(
      expect.arrayContaining([
        'dns',
        'tls',
        'reachability',
        'links',
        'forms',
        'widget',
        'tours',
        'inventory',
        'indexability',
        'sitemap',
        'brand',
        'legal',
        'accessibility',
        'performance',
      ])
    )
  })

  it('detects identity and indexability regressions with injected I/O', async () => {
    const contentHash = 'a'.repeat(64)
    const body = `
      <html lang="en">
        <head>
          <title>Example Apartments</title>
          <meta name="robots" content="noindex">
        </head>
        <body data-siteforge-content-hash="${'b'.repeat(64)}">
          <img class="logo" alt="Example logo">
          <a href="/privacy">Privacy</a>
          <a href="/fair-housing">Equal Housing</a>
        </body>
      </html>
    `
    const context = {
      orgId: 'org',
      propertyId: 'property',
      websiteId: 'website',
      artifactId: 'artifact',
      contentHash,
      url: 'https://example.test',
      fetch: vi.fn(),
      document: async () => ({
        body,
        status: 200,
        elapsedMs: 50,
        headers: new Headers(),
      }),
    }
    const probes = createDefaultSiteForgeHealthProbes()
    await expect(probes.indexability(context)).resolves.toMatchObject({
      passed: false,
      severity: 'high',
    })
    await expect(probes.identity(context)).resolves.toMatchObject({
      passed: false,
      severity: 'critical',
    })
  })
})
