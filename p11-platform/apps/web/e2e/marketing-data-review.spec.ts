import { expect, test } from '@playwright/test'
const property = '33333333-3333-3333-3333-333333333333'
const url = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430'
test.skip(!['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Local fixture login only')
test.beforeEach(async ({ page }) => {
  await page.goto('/auth/login')
  await page.getByLabel('Email address').fill('local-admin@p11.test')
  await page.getByLabel('Password', { exact: true }).fill('local-dev-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL(/\/auth\/login/)
  await page.route('**/api/properties', route => route.fulfill({ json: { properties: [{ id: property, name: 'P11 Local Demo Property' }] } }))
})
const review = { complete: true, checkedAt: '2026-09-14', recordsChecked: 1205, recordsNeedingReview: 1, counts: { account: 1, currency: 0, legacy: 1, duplicate: 0, metrics: 0 }, issues: [{ id: 'fixture', date: '2026-09-10', campaign: 'Earlier campaign', channel: 'meta_ads', account: null, reasons: ['account', 'legacy'] }] }
for (const mobile of [false, true]) test(`reviews the complete record count and downloads the report (${mobile ? 'phone' : 'desktop'})`, async ({ page }) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/analytics/reconciliation?**', route => route.fulfill({ json: review }))
  await page.goto('/dashboard/bi')
  await page.getByRole('button', { name: 'Review data', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('1,205 records checked.')
  await expect(dialog).toContainText('Earlier campaign')
  await expect(dialog).toContainText('Account needs review')
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download review' }).click()
  expect((await download).suggestedFilename()).toMatch(/^marketing-data-review-/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `/Users/jasjitgill/Documents/Codex/2026-09-12/we-x20/work/phase-zero-completion/review-${mobile ? 'phone' : 'desktop'}.png`, fullPage: true, animations: 'disabled' })
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible()
})
test('makes an incomplete review visible and supports a confirmed retry', async ({ page }) => {
  let calls = 0
  await page.route('**/api/analytics/reconciliation?**', route => { calls++; return calls === 1 ? route.fulfill({ status: 503, json: { error: 'Complete reporting data could not be loaded. Try again.' } }) : route.fulfill({ json: review }) })
  await page.goto('/dashboard/bi'); await page.getByRole('button', { name: 'Review data', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('could not be loaded')
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('1,205 records checked.')
})
test('actual review endpoint preserves property access and confirms its database snapshot', async ({ page }) => {
  const good = await page.request.get(`/api/analytics/reconciliation?propertyId=${property}&startDate=2026-09-01&endDate=2026-09-14`)
  expect(good.status()).toBe(200); const body = await good.json(); expect(body.complete).toBe(true); expect(body.recordsChecked).toBeGreaterThanOrEqual(0)
  expect(good.headers()['cache-control']).toBe('private, no-store')
  const forbidden = await page.request.get('/api/analytics/reconciliation?propertyId=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  expect(forbidden.status()).toBe(403)
})
