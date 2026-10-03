import { describe, expect, it, vi } from 'vitest'
import { healthEvidenceState, isVerifiedHealthCheck, monitoringPurpose, summarizeHealthChecks } from './health-state'
import { nextHealthAlertState } from './health-alert-state'
import { createDefaultSiteForgeHealthProbes, isHtmlHealthDocument } from './production-health'

const url = 'https://example.test'
function context(body = '<html lang="en"></html>', status = 200) {
  const document = { url, body, status, elapsedMs: 10, headers: new Headers({ 'content-type': 'text/html' }) }
  return { url, orgId: 'org', propertyId: 'property', websiteId: 'website', artifactId: 'artifact',
    contentHash: 'a'.repeat(64), fetch: vi.fn(), document: async () => document,
    documents: async () => [document] }
}
const probes = createDefaultSiteForgeHealthProbes()

describe('evidence, scope and alert eligibility', () => {
  it.each(['not_configured', 'unobservable'])('never verifies legacy passed=true with state %s', state => {
    expect(isVerifiedHealthCheck({ passed: true, state })).toBe(false)
    expect(healthEvidenceState({ passed: true, state })).toBe(state)
  })
  it('keeps legacy false applicability out of passes and counts all four states', () => {
    expect(isVerifiedHealthCheck({ passed: true, evidence: { applicable: false } })).toBe(false)
    expect(summarizeHealthChecks({ a: { passed: true }, b: { passed: false }, c: { state: 'not_configured' }, d: null }))
      .toEqual({ healthy: 1, failed: 1, not_configured: 1, unobservable: 1 })
  })
  it('derives purpose from a matching active target and explicit test ownership', () => {
    const target = { site_url: url, is_active: true, target_type: 'production', metadata: {} }
    expect(monitoringPurpose(target, url)).toBe('production')
    expect(monitoringPurpose({ ...target, metadata: { lifecycleOwnerId: 'owner', lifecycleRunId: 'run' } }, url)).toBe('testbed')
    expect(monitoringPurpose({ ...target, metadata: { monitoringPurpose: 'review' } }, url)).toBe('review')
    expect(monitoringPurpose({ ...target, is_active: false }, url)).toBe('unknown')
    expect(monitoringPurpose(target, url + '/other')).toBe('unknown')
    expect(monitoringPurpose(null, url)).toBe('unknown')
    expect(monitoringPurpose({ ...target, target_type: 'canonical_preview', metadata: { monitoringPurpose: 'production' } }, url)).toBe('unknown')
  })
  it('does not enroll historical incidents, and alerts only on a new incident or escalation', () => {
    expect(nextHealthAlertState(null, 'high')).toMatchObject({ state: 'pending' })
    expect(nextHealthAlertState({ severity: 'high', evidence: {} }, 'high')).toMatchObject({ state: 'historical' })
    const accepted = { severity: 'high', evidence: { notification: { version: 1, state: 'accepted', severity: 'high' } } }
    expect(nextHealthAlertState(accepted, 'medium')).toMatchObject({ state: 'accepted', severity: 'high' })
    expect(nextHealthAlertState(accepted, 'critical')).toMatchObject({ state: 'pending', severity: 'critical' })
  })
  it('excludes feeds and JSON from HTML checks even if they contain markup', () => {
    for (const type of ['application/rss+xml', 'application/xml', 'application/json'])
      expect(isHtmlHealthDocument({ headers: new Headers({ 'content-type': type }), body: '<html></html>' })).toBe(false)
    expect(isHtmlHealthDocument({ headers: new Headers(), body: '<?xml version="1.0"?><rss />' })).toBe(false)
    expect(isHtmlHealthDocument({ headers: new Headers(), body: '<!doctype html><html></html>' })).toBe(true)
  })
  it('does not treat a 404 homepage as reachable', async () => {
    await expect(probes.reachability(context('', 404))).resolves.toMatchObject({ state: 'failed', severity: 'critical' })
  })
  it.each(['identity', 'content_drift', 'runtime', 'forms', 'widget', 'tours', 'inventory', 'plugin_vulnerabilities', 'expiring_specials'] as const)
    ('keeps absent %s evidence unavailable', async check => {
      await expect(probes[check](context())).resolves.toMatchObject({ passed: false, state: 'unobservable' })
    })
  it('does not infer a working form from client-side markup without an endpoint', async () => {
    await expect(probes.forms(context('<html><form id="contact"><input></form></html>')))
      .resolves.toMatchObject({ state: 'unobservable' })
  })
  it.each(['testbed', 'review', 'staging'] as const)('does not require public indexing of %s', async purpose => {
    const ctx = { ...context('<html><meta name="robots" content="noindex"></html>'), purpose }
    await expect(probes.indexability(ctx)).resolves.toMatchObject({ state: 'not_configured', passed: false })
    await expect(probes.sitemap(ctx)).resolves.toMatchObject({ state: 'not_configured' })
    expect(ctx.fetch).not.toHaveBeenCalled()
  })
  it.each(['NaN', '-1', '1.5', 'n/a'])('rejects invalid vulnerability evidence %s', async raw => {
    const ctx = context()
    const doc = await ctx.document()
    doc.headers.set('x-siteforge-plugin-vulnerabilities', raw)
    await expect(probes.plugin_vulnerabilities(ctx)).resolves.toMatchObject({ state: 'unobservable' })
  })
  it('distinguishes an unloaded connector configuration from explicitly empty configuration', async () => {
    await expect(probes.connector_freshness(context())).resolves.toMatchObject({ state: 'unobservable' })
    await expect(probes.connector_freshness({ ...context(), connectors: [] })).resolves.toMatchObject({ state: 'not_configured' })
  })
  it.each([null, 'not-a-date'])('does not certify an active connector without a valid last-success observation: %s', async lastSuccessAt => {
    await expect(probes.connector_freshness({ ...context(), connectors: [{ id: 'connector', capability: 'inventory', status: 'active', lastSuccessAt, freshnessSeconds: 60 }] }))
      .resolves.toMatchObject({ state: 'unobservable' })
  })
  it('does not fail HTML accessibility because a successful RSS feed lacks lang', async () => {
    const ctx = context()
    const doc = await ctx.document()
    ctx.documents = async () => [doc, { ...doc, url: url + '/feed', body: '<rss/>', headers: new Headers({ 'content-type': 'application/rss+xml' }) }]
    await expect(probes.accessibility(ctx)).resolves.toMatchObject({ state: 'healthy', evidence: { pages: 1 } })
  })
})
