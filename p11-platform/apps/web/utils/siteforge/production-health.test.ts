import { describe, expect, it, vi } from 'vitest'
import {
  createDefaultSiteForgeHealthProbes,
  declaredSiteForgePagePaths,
  recordedLaunchOperatorForHealthRestore,
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
        'redirects',
        'forms',
        'widget',
        'tours',
        'inventory',
        'connector_freshness',
        'indexability',
        'sitemap',
        'brand',
        'legal',
        'accessibility',
        'performance',
        'identity',
        'runtime',
        'plugin_vulnerabilities',
        'expiring_specials',
        'content_drift',
      ])
    )
  })

  it('normalizes only declared internal page journeys', () => {
    expect(
      declaredSiteForgePagePaths([
        { slug: 'floor-plans' },
        { path: '/amenities/' },
        { slug: '/' },
        { slug: 'https://external.test/page' },
      ])
    ).toEqual(['/amenities/', '/floor-plans/'])
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
    const document = {
      body,
      status: 200,
      elapsedMs: 50,
      headers: new Headers(),
    }
    const context = {
      orgId: 'org',
      propertyId: 'property',
      websiteId: 'website',
      artifactId: 'artifact',
      contentHash,
      url: 'https://example.test',
      fetch: vi.fn(),
      document: async () => document,
      documents: async () => [{ url: 'https://example.test', ...document }],
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

  it('checks linked pages instead of accepting syntactically valid URLs', async () => {
    const homepage = {
      url: 'https://example.test',
      body: '<a href="/floor-plans/">Floor plans</a>',
      status: 200,
      elapsedMs: 20,
      headers: new Headers(),
    }
    const context = {
      orgId: 'org',
      propertyId: 'property',
      websiteId: 'website',
      artifactId: 'artifact',
      contentHash: 'a'.repeat(64),
      url: homepage.url,
      fetch: vi.fn(),
      document: async () => homepage,
      documents: async () => [
        homepage,
        {
          ...homepage,
          url: 'https://example.test/floor-plans/',
          status: 404,
        },
      ],
    }

    await expect(
      createDefaultSiteForgeHealthProbes().links(context)
    ).resolves.toMatchObject({
      passed: false,
      severity: 'high',
    })
  })

  it('reports connector freshness and explicit runtime contracts', async () => {
    const body =
      '<html data-siteforge-runtime-status="degraded" data-siteforge-plugin-vulnerabilities="2"></html>'
    const document = {
      body,
      status: 200,
      elapsedMs: 20,
      headers: new Headers(),
    }
    const context = {
      orgId: 'org',
      propertyId: 'property',
      websiteId: 'website',
      artifactId: 'artifact',
      contentHash: 'a'.repeat(64),
      url: 'https://example.test',
      connectors: [
        {
          id: 'connector',
          capability: 'inventory',
          status: 'active',
          lastSuccessAt: '2026-01-01T00:00:00.000Z',
          freshnessSeconds: 60,
        },
      ],
      fetch: vi.fn(),
      document: async () => document,
      documents: async () => [{ url: 'https://example.test', ...document }],
    }
    const probes = createDefaultSiteForgeHealthProbes()
    await expect(probes.connector_freshness(context)).resolves.toMatchObject({
      passed: false,
      severity: 'high',
    })
    await expect(probes.runtime(context)).resolves.toMatchObject({
      passed: false,
      severity: 'critical',
    })
    await expect(probes.plugin_vulnerabilities(context)).resolves.toMatchObject({
      passed: false,
      severity: 'critical',
    })
  })

  it('attributes health restore execution to the launch operator, never the reviewer', () => {
    expect(
      recordedLaunchOperatorForHealthRestore({
        created_by: 'launch-operator',
        approved_by: 'independent-reviewer',
      })
    ).toBe('launch-operator')
    expect(
      recordedLaunchOperatorForHealthRestore({
        created_by: 'same-actor',
        approved_by: 'same-actor',
      })
    ).toBeNull()
    expect(
      recordedLaunchOperatorForHealthRestore({
        created_by: null,
        approved_by: 'independent-reviewer',
      })
    ).toBeNull()
  })
})
