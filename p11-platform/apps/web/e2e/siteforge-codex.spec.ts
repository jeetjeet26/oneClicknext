import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {buildSiteForgeCodexBrief}from '@/utils/siteforge/codex-brief'
import {randomUUID}from 'node:crypto'

const propertyA = '33333333-3333-3333-3333-333333333333'
const propertyB = '44444444-4444-4444-4444-444444444444'
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000'
test.skip(!['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname), 'Local test account only')

// These pre-existing UI checks mock the saved-history API. The dedicated
// siteforge-brief-history suite verifies actual local persistence and cleanup.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(id => localStorage.setItem('p11_selected_property_id', id), propertyA)
  const documents=new Map<string,string>()
  await page.route('**/api/siteforge/codex-briefs?*',route=>route.fulfill({json:{state:'ready',briefs:[],selected:null,count:0,exports:[],nextCursor:null,nextExportCursor:null}}))
  await page.route('**/api/siteforge/codex-briefs',route=>{const input=route.request().postDataJSON(),document=buildSiteForgeCodexBrief({...input.draft,property:{...input.property,city:input.property.city??undefined}});documents.set(input.requestId,document);return route.fulfill({json:{result:{state:'saved',briefId:input.requestId,document}}})})
  await page.route('**/api/siteforge/codex-briefs/export',route=>{const input=route.request().postDataJSON();return route.fulfill({json:{result:input.action==='prepare'?{state:'prepared',exportId:input.requestId||randomUUID(),briefId:input.briefId,document:documents.get(input.briefId)}:{state:'recorded'}}})})
  await page.goto('/auth/login')
  await page.getByLabel('Email address').fill('local-admin@p11.test')
  await page.getByLabel('Password', { exact: true }).fill('local-dev-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL(/\/auth\/login/)
})

test('exports the exact brief without creating a generator project, including an old regenerate link', async ({ page, context }) => {
  const mutations: string[] = []
  page.on('request', request => {
    if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/siteforge/')) mutations.push(request.url())
  })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto(`/dashboard/siteforge?regeneratePropertyId=${propertyA}`)
  await page.getByText('Earlier briefs and delivery history', { exact: true }).click()
  const copy = page.getByRole('button', { name: 'Copy brief for Codex' })
  await expect(copy).toBeDisabled()
  await page.getByLabel('What would you like to build or change?').fill('Update only the gallery. Preserve every other page.')
  await page.getByLabel('References and source notes').fill('Use the supplied design.pdf and current gallery images.')
  await page.getByLabel('Website platform').selectOption('wordpress')
  await page.getByText('Revision details (optional)', { exact: true }).click()
  await page.getByLabel('What should stay unchanged?', { exact: true }).fill('Keep the homepage and inquiry flow')
  await page.getByLabel('Version to compare with', { exact: true }).fill('Approved September review')
  await page.getByText('Editing and launch details (optional)', { exact: true }).click()
  await page.getByLabel('Current website or project', { exact: true }).fill('Existing client source and separate review target')
  await page.getByLabel('Who updates the content?', { exact: true }).fill('Client editors use existing ACF; inventory owner pending')
  await page.getByLabel('Where should inquiries go?', { exact: true }).fill('Confirm the leasing inbox before delivery')
  await page.getByText('Preview the brief', { exact: true }).click()
  const prepared = await page.getByLabel('Prepared Codex brief').inputValue()
  expect(prepared).toContain('Update only the gallery. Preserve every other page.')
  expect(prepared).toContain(propertyA)
  expect(prepared).toContain('Keep the homepage and inquiry flow')
  expect(prepared).toContain('Approved September review')
  expect(prepared).toContain('Client editors use existing ACF; inventory owner pending')
  expect(prepared).toContain('Confirm the leasing inbox before delivery')
  expect(prepared).toContain('Deliver and verify a native WordPress site.')
  await copy.click()
  await expect(page.getByRole('status').filter({ hasText: 'Brief copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prepared)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download brief' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('p11-local-demo-property-siteforge-brief.md')
  expect(await readFile((await download.path())!, 'utf8')).toBe(prepared)
  expect(mutations.every(url=>new URL(url).pathname.startsWith('/api/siteforge/codex-briefs'))).toBe(true)
})

test('property switching clears the prior brief and cancels stale record responses', async ({ page }) => {
  await page.route('**/api/properties', route => route.fulfill({ json: { properties: [
    { id: propertyA, name: 'First community', settings: { city: 'Austin' } },
    { id: propertyB, name: 'Second community', settings: { city: 'Torrance' } },
  ] } }))
  await page.route('**/api/siteforge/list?*', async route => {
    const first = new URL(route.request().url()).searchParams.get('propertyId') === propertyA
    if (first) await new Promise(resolve => setTimeout(resolve, 500))
    await route.fulfill({ json: { websites: first ? [{ id: 'stale-project', version: 99, generationStatus: 'queued', generationProgress: 12, createdAt: '2026-09-01T12:00:00Z', isPlanning: false }] : [] } })
  })
  await page.goto('/dashboard/siteforge')
  await page.getByText('Earlier briefs and delivery history', { exact: true }).click()
  await page.getByLabel('What would you like to build or change?').fill('Private request for the first community')
  await page.getByLabel('References and source notes').fill('First community only')
  await page.getByText('Editing and launch details (optional)', { exact: true }).click()
  await page.getByLabel('Current website or project', { exact: true }).fill('First community source only')
  await page.getByLabel('Who updates the content?', { exact: true }).fill('First community editor')
  await page.getByLabel('Where should inquiries go?', { exact: true }).fill('First community destination')
  await page.getByText('Revision details (optional)', { exact: true }).click()
  await page.getByLabel('What should stay unchanged?', { exact: true }).fill('Private boundaries for first community')
  await page.getByLabel('Version to compare with', { exact: true }).fill('First community parent')
  await page.locator('header select').selectOption(propertyB)
  await page.getByText('Revision details (optional)', { exact: true }).click()
  await expect(page.getByLabel('What should stay unchanged?', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Version to compare with', { exact: true })).toHaveValue('')
  await page.getByText('Editing and launch details (optional)', { exact: true }).click()
  await expect(page.getByLabel('Current website or project', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Who updates the content?', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Where should inquiries go?', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('What would you like to build or change?')).toHaveValue('')
  await expect(page.getByLabel('References and source notes')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Copy brief for Codex' })).toBeDisabled()
  await expect(page.getByRole('heading', { name: 'No earlier console projects' })).toBeVisible()
  await expect(page.getByText('Website v99', { exact: true })).toHaveCount(0)
  await page.getByLabel('What would you like to build or change?').fill('Second community gallery update')
  await page.getByText('Preview the brief', { exact: true }).click()
  const brief = await page.getByLabel('Prepared Codex brief').inputValue()
  expect(brief).toContain(propertyB)
  expect(brief).not.toContain(propertyA)
  expect(brief).not.toContain('First community only')
  expect(brief).not.toContain('Private boundaries for first community')
  expect(brief).not.toContain('First community parent')
})

test('failed records stay visibly failed and can be refreshed while briefing still works', async ({ page }) => {
  let failing = true
  await page.route('**/api/siteforge/list?*', route => failing
    ? route.fulfill({ status: 503, json: { error: 'Records temporarily unavailable' } })
    : route.fulfill({ json: { websites: [] } }))
  await page.goto('/dashboard/siteforge')
  await page.getByText('Earlier briefs and delivery history', { exact: true }).click()
  await expect(page.getByText('Records temporarily unavailable')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No earlier console projects' })).toHaveCount(0)
  await page.getByLabel('What would you like to build or change?').fill('Prepare the next site')
  await expect(page.getByRole('button', { name: 'Download brief' })).toBeEnabled()
  failing = false
  await page.getByRole('region', { name: 'Earlier console projects' }).getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByText('Records temporarily unavailable')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'No earlier console projects' })).toBeVisible()
})

test('clipboard denial provides the exact manually copyable preview', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('Clipboard denied') } } })
  })
  await page.goto('/dashboard/siteforge')
  await page.getByText('Earlier briefs and delivery history', { exact: true }).click()
  await page.getByLabel('What would you like to build or change?').fill('Replace one gallery photo')
  await page.getByRole('button', { name: 'Copy brief for Codex' }).click()
  await expect(page.getByText('Clipboard access is unavailable.', { exact: false })).toBeVisible()
  await expect(page.getByLabel('Prepared Codex brief')).toBeVisible()
  expect(await page.getByLabel('Prepared Codex brief').inputValue()).toContain('Replace one gallery photo')
})


test('does not turn an empty property response into a brief for a demo property', async ({ page }) => {
  await page.route('**/api/properties', route => route.fulfill({ json: { properties: [] } }))
  await page.goto('/dashboard/siteforge')
  await expect(page.getByRole('heading',{name:'Add your first property',exact:true})).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy brief for Codex' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Earlier console projects' })).toHaveCount(0)
})


test('optional delivery details remain usable on a phone and do not block a partial brief', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/dashboard/siteforge')
  await page.getByText('Earlier briefs and delivery history', { exact: true }).click()
  await page.getByLabel('What would you like to build or change?').fill('Prepare a new rental site with the supplied brand')
  await page.getByText('Editing and launch details (optional)', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Download brief' })).toBeEnabled()
  await page.getByLabel('Who updates the content?', { exact: true }).fill('Client uses WordPress')
  await page.getByText('Revision details (optional)', { exact: true }).click()
  await page.getByLabel('What should stay unchanged?', { exact: true }).fill('Preserve approved content')
  await page.locator('details').filter({ hasText: 'Editing and launch details (optional)' }).last().screenshot({ path: '/Users/jasjitgill/Documents/Codex/2026-09-12/we-x20/work/phase-three/delivery-notes-phone.png' })
  await page.getByText('Preview the brief', { exact: true }).click()
  const brief = await page.getByLabel('Prepared Codex brief').inputValue()
  expect(JSON.parse(brief.match(/```json\n([\s\S]*?)\n```/)![1]).deliveryNotes).toEqual({ projectLocation: null, contentOwnership: 'Client uses WordPress', inquiryDestination: null })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '/Users/jasjitgill/Documents/Codex/2026-09-12/we-x20/work/phase-three/siteforge-phone.png', fullPage: true, animations: 'disabled' })
})
