import { expect, test, type Page } from '@playwright/test'
import type { Database } from '@/types/supabase'
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000'
const enabled = process.env.SITEFORGE_LOCAL_DATABASE_TEST === '1'
test.skip(!enabled || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Opt-in loopback fixtures only')
const websiteId = randomUUID()
const propertyId = '33333333-3333-3333-3333-333333333333'
const orgId = '22222222-2222-2222-2222-222222222222'
const empty = { activeIncidentCount: 0, incidents: [], healthRuns: [], repairs: [] }
const incomplete = { ...empty, healthRuns: [{ id: randomUUID(), status: 'healthy', trigger_type: 'manual',
  started_at: '2026-09-15T20:00:00Z', completed_at: '2026-09-15T20:00:01Z', evidence: { purpose: 'review' },
  checks: { identity: { passed: true, state: 'unobservable', summary: 'Remote identity marker unavailable' },
    accessibility: { passed: true, state: 'healthy', summary: 'One HTML page checked; feed excluded' },
    indexability: { passed: true, state: 'not_configured', summary: 'Indexing is not required for this review target' } } }] }
const operations = { website: { property_id: propertyId, editor_lifecycle_status: 'draft', target_domain: null },
  releases: [], certifications: [], restores: [], rollbackHistory: [], productionTarget: null,
  productionProvisioningJob: null, automaticProductionLaunch: false, browserCertifierConfigured: false }
let client: ReturnType<typeof createClient<Database>>

test.beforeAll(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Refusing non-local fixture storage')
  client = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const result = await client.from('property_websites').insert({ id: websiteId, property_id: propertyId,
    org_id: orgId, generation_status: 'complete', generation_input: { monitoringFixture: websiteId } })
  if (result.error) throw result.error
})
test.afterAll(async () => {
  if (!client) return
  execFileSync('docker', ['exec', '-i', 'supabase_db_p11-platform', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'], {
    input: `BEGIN; SET LOCAL session_replication_role = replica;
      DELETE FROM siteforge_launch_policies WHERE website_id = '${websiteId}' AND EXISTS (SELECT 1 FROM property_websites WHERE id = '${websiteId}' AND generation_input->>'monitoringFixture' = '${websiteId}');
      SET LOCAL session_replication_role = origin;
      DELETE FROM property_websites WHERE id = '${websiteId}' AND generation_input->>'monitoringFixture' = '${websiteId}'; COMMIT;`,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  expect((await client.from('property_websites').select('id').eq('id', websiteId)).data).toEqual([])
})

test.beforeEach(async ({ page }) => {
  await page.goto('/auth/login')
  await page.getByLabel('Email address').fill('local-admin@p11.test')
  await page.getByLabel('Password', { exact: true }).fill('local-dev-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL(/auth\/login/)
  await page.route('**/api/siteforge/**', async route => {
    if (route.request().method() !== 'GET') return route.abort('blockedbyclient')
    return route.fallback()
  })
  // Only the retained editor's navigation and operations display are fixtures.
  // No artifact, launch, provider request or production website is created.
  await page.route(`**/api/siteforge/director/${websiteId}`, async route => route.fulfill({ json: {
    stage: { key: 'production', label: 'Fixture', status: 'ready' }, artifact: { current: { artifactId: 'display-fixture', version: 1 } },
    blockers: [], jobs: [], commands: [],
  } }))
  await page.route(`**/api/siteforge/guided/${websiteId}/snapshot`, route => route.fulfill({ json: {
    state: null, question: null, creativeDirection: null, journey: { stage: 'launch', blocker: null },
  } }))
  await page.route(`**/api/siteforge/operations/${websiteId}`, route => route.fulfill({ json: operations }))
  await page.route('**/api/siteforge/launch/**', route => route.fulfill({ status: 404, json: { error: 'No launch release for this fixture' } }))
})
async function open(page: Page) {
  await page.goto(`/dashboard/siteforge/${websiteId}`)
  await page.getByRole('button', { name: 'Resume / refresh' }).click()
  await expect(page.getByText('Production operations', { exact: true })).toBeVisible()
}

test('loading is distinct from zero incidents and unrecorded health', async ({ page }) => {
  let release: () => void = () => undefined
  const wait = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/siteforge/incidents?**', async route => { await wait; await route.fulfill({ json: empty }) })
  await open(page)
  await expect(page.getByText('Loading monitoring history…', { exact: true })).toBeVisible()
  await expect(page.getByText('0 active', { exact: true })).toHaveCount(0)
  release()
  await expect(page.getByText('No recorded run', { exact: true })).toBeVisible()
})

test('failed history can be retried and then reads the real empty local history', async ({ page }) => {
  let failed = true
  await page.route('**/api/siteforge/incidents?**', async route => {
    if (failed) return route.fulfill({ status: 503, json: { error: 'Fixture history unavailable' } })
    return route.continue()
  })
  await open(page)
  await expect(page.getByRole('alert').filter({ hasText: 'Monitoring history unavailable' })).toBeVisible()
  await expect(page.getByText('0 active', { exact: true })).toHaveCount(0)
  failed = false
  await page.getByRole('button', { name: 'Retry loading history' }).click()
  await expect(page.getByText('0 active', { exact: true })).toBeVisible()
  await expect(page.getByText('No recorded run', { exact: true })).toBeVisible()
})

test('legacy unknown passes stay incomplete and check details disclose scope', async ({ page }, testInfo) => {
  await page.route('**/api/siteforge/incidents?**', route => route.fulfill({ json: incomplete }))
  await open(page)
  await expect(page.getByText('Evidence incomplete', { exact: true })).toBeVisible()
  await expect(page.getByText('1 verified · 0 failed · 1 unavailable · 1 not applicable')).toBeVisible()
  await page.getByText('Check details', { exact: true }).click()
  await expect(page.getByText('Remote identity marker unavailable', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Monitoring evidence')).toContainText('Target: review')
  await page.getByLabel('Monitoring evidence').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('monitoring-desktop.png') })
})

test('a failed refresh removes stale incident counts and exposes retry', async ({ page }) => {
  let failed = false
  await page.route('**/api/siteforge/incidents?**', route => route.fulfill(failed
    ? { status: 503, json: { error: 'Fixture refresh failed' } } : { json: incomplete }))
  await open(page)
  await expect(page.getByText('Evidence incomplete', { exact: true })).toBeVisible()
  failed = true
  await page.getByRole('button', { name: 'Refresh history' }).click()
  await expect(page.getByRole('button', { name: 'Retry loading history' })).toBeVisible()
  await expect(page.getByText('0 active', { exact: true })).toHaveCount(0)
})

test('monitoring remains readable on a phone with complete active counts', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/siteforge/incidents?**', route => route.fulfill({ json: { ...incomplete, activeIncidentCount: 846,
    incidents: [{ id: 'fixture-incident', category: 'accessibility', severity: 'medium', status: 'acknowledged', summary: 'Representative saved incident with an unusually-long-reference-that-must-not-force-the-phone-page-to-overflow.example', created_at: '2026-09-15T20:00:00Z' }] } }))
  await open(page)
  await expect(page.getByText('846 active', { exact: true })).toBeVisible()
  await expect(page.getByText('Showing the latest 1 of 846 active incidents. Older records remain saved.')).toBeVisible()
  const evidence = page.getByLabel('Monitoring evidence')
  await evidence.scrollIntoViewIfNeeded()
  await expect(evidence).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('monitoring-mobile.png') })
})

test('saved operational incidents expose ownership and held alert delivery', async ({ page }) => {
  const incidentId=randomUUID()
  const saved=await client.from('siteforge_incidents').insert({id:incidentId,website_id:websiteId,property_id:propertyId,org_id:orgId,
    dedupe_key:'operation:restore',severity:'high',status:'acknowledged',owner_id:'11111111-1111-1111-1111-111111111111',
    category:'restore_execution',title:'Restore needs attention',summary:'Fixture restore outcome needs review',
    evidence:{notification:{version:1,state:'unconfirmed',severity:'high'}}})
  if(saved.error)throw saved.error
  try {
    await open(page)
    await expect(page.getByText('restore execution',{exact:true})).toBeVisible()
    await expect(page.getByText('Assigned · acknowledged',{exact:true})).toBeVisible()
    await expect(page.getByText('Alert delivery unconfirmed; review before retrying.',{exact:true})).toBeVisible()
    await expect(page.getByText('Fixture restore outcome needs review',{exact:true})).toBeVisible()
  } finally { const removed=await client.from('siteforge_incidents').delete().eq('id',incidentId);if(removed.error)throw removed.error }
})


test('blocked sender guidance is readable from the saved incident on desktop and phone', async ({ page }, testInfo) => {
  const incidentId = randomUUID()
  const saved = await client.from('siteforge_incidents').insert({ id: incidentId, website_id: websiteId,
    property_id: propertyId, org_id: orgId, dedupe_key: 'operation:monitoring', severity: 'high',
    status: 'open', category: 'monitoring_execution', title: 'Monitoring needs attention',
    summary: 'Fixture monitoring outcome needs review', evidence: { notification: {
      version: 1, state: 'blocked', severity: 'high', failureCode: 'sender_domain_unverified',
      error: 'private-provider-detail-must-not-render',
    } } })
  if (saved.error) throw saved.error
  try {
    await open(page)
    const explanation = page.getByText('Alert not sent; delivery needs attention.', { exact: false })
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport)
      await explanation.scrollIntoViewIfNeeded()
      await expect(explanation).toBeVisible()
      await expect(explanation).toContainText('sender domain is not verified')
      await expect(explanation).toContainText('will not be retried automatically')
      await expect(page.getByText('private-provider-detail-must-not-render', { exact: false })).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`blocked-alert-${viewport.width}.png`) })
    }
  } finally {
    const removed = await client.from('siteforge_incidents').delete().eq('id', incidentId)
    if (removed.error) throw removed.error
  }
})
