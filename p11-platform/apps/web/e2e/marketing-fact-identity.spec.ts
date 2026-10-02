import { expect, test } from '@playwright/test'
import {buildBiReport} from '../utils/analytics/report-data'
const property = '33333333-3333-3333-3333-333333333333'
const url = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430'
test.skip(!['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Local fixture login only')
const campaigns = ['1111111111', '2222222222'].map((account, index) => ({
  campaign_id: '100', campaign_name: 'Shared campaign', source_account_id: account,
  campaign_key: JSON.stringify(['google_ads', account, '100']), channel: 'google_ads',
  impressions: 100, clicks: 10, spend: 12.5, conversions: index ? 0.75 : 0.000125,
  ctr: 10, cpc: 1.25, cpa: 12.5 / (index ? 0.75 : 0.000125), first_date: '2026-09-10', last_date: '2026-09-10',
}))
test.beforeEach(async ({ page }) => {
  await page.goto('/auth/login')
  await page.getByLabel('Email address').fill('local-admin@p11.test')
  await page.getByLabel('Password', { exact: true }).fill('local-dev-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL(/\/auth\/login/)
  await page.route('**/api/properties', route => route.fulfill({ json: { properties: [{ id: property, name: 'P11 Local Demo Property' }] } }))
  await page.route('**/api/analytics/reports?**',route=>{
    const query=new URL(route.request().url()).searchParams
    if(!query.has('startDate'))return route.continue()
    const source={version:'bi-v1' as const,propertyId:property,propertyName:'P11 Local Demo Property',filters:{startDate:query.get('startDate')!,endDate:query.get('endDate')!,compare:false,channel:null,account:null},currentRows:campaigns.map((c,i)=>({id:String(i),date:'2026-09-10',channel_id:c.channel,source_account_id:c.source_account_id,currency_code:'USD',campaign_id:c.campaign_id,campaign_name:c.campaign_name,impressions:c.impressions,clicks:c.clicks,spend:c.spend,conversions:c.conversions})),previousRows:[],previousPeriod:null}
    return route.fulfill({json:{propertyId:property,actorId:'11111111-1111-1111-1111-111111111111',sourceHash:'a'.repeat(64),...buildBiReport(source)}})
  })
})

test('separates account labels and uses the selected account from the same snapshot', async ({ page }) => {
  let trendCalls=0
  await page.route('**/api/analytics/campaigns?**',route=>{trendCalls++;return route.abort()})
  await page.goto('/dashboard/bi')
  await page.getByRole('button', { name: /Campaign Breakdown/ }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Account 1111111111' })).toContainText('0.000125')
  await page.getByRole('row').filter({ hasText: 'Account 2222222222' }).click()
  await expect(page.getByText('ID: 100 · Account 2222222222')).toBeVisible()
  expect(trendCalls).toBe(0)
})

test('makes a failed report visible without retaining older campaign data', async ({ page }) => {
  await page.goto('/dashboard/bi')
  await page.getByRole('button', { name: /Campaign Breakdown/ }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Account 1111111111' })).toBeVisible()
  await page.route('**/api/analytics/reports?**',route=>new URL(route.request().url()).searchParams.has('startDate')?route.fulfill({status:503,json:{error:'Report fixture unavailable'}}):route.fallback())
  await page.getByRole('button',{name:'Refresh data',exact:true}).click()
  await expect(page.getByRole('alert').filter({hasText:'Report fixture unavailable'})).toBeVisible()
  await expect(page.getByRole('row').filter({hasText:'Account 1111111111'})).toHaveCount(0)
})

// Reviewed CSV identity, fractional values and real import recovery are covered by bi-csv-imports.spec.ts.
