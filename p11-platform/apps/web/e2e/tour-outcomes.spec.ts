import {expect, test as base} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430'
const databaseURL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const local = ['localhost','127.0.0.1']
const createFixtureClient = () => createClient(databaseURL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
base.skip(!local.includes(new URL(baseURL).hostname), 'Local fixtures only')
const test = base.extend<{fixture: {property: string; lead: string; tour: string; db: ReturnType<typeof createFixtureClient>; date: string; time: string}}>({
  fixture: async ({}, provideFixture) => {
    if (!databaseURL || !local.includes(new URL(databaseURL).hostname)) throw new Error('A local database is required')
    const db=createFixtureClient()
    const property=randomUUID(), lead=randomUUID(), tour=randomUUID()
    const recent=new Date(Date.now()-3*3600000).toISOString(),date=recent.slice(0,10),time=recent.slice(11,16)
    async function save(query: PromiseLike<{error: unknown}>) {const result=await query; if(result.error) throw result.error}
    try {
      await save(db.from('properties').insert({id:property,name:'Tour outcome browser fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{timezone:'UTC'}}))
      await save(db.from('leads').insert({id:lead,property_id:property,first_name:'Outcome',last_name:'Fixture',email:'tour-outcome@example.invalid',source:'manual',status:'tour_booked'}))
      await save(db.from('tours').insert({id:tour,property_id:property,lead_id:lead,tour_date:date,tour_time:time,status:'confirmed'}))
      await save(db.from('workflow_definitions').insert({property_id:property,name:'Local outcome follow-up',trigger_on:'tour_completed',steps:[{action:'email',template_slug:'local-only',delay_hours:8760}],exit_conditions:['leased','lost']}))
      await provideFixture({property,lead,tour,db,date,time})
    } finally {
      await save(db.from('leads').delete().eq('id',lead))
      execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
      expect((await db.from('properties').select('id').eq('id',property)).data).toHaveLength(0)
    }
  },
})
test.beforeEach(async ({page}) => {
  await page.goto('/auth/login')
  await page.getByLabel('Email address').fill('local-admin@p11.test')
  await page.getByLabel('Password',{exact:true}).fill('local-dev-password')
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await expect(page).not.toHaveURL(/\/auth\/login/)
})
async function openTour(page: import('@playwright/test').Page, property: string) {
  await page.goto('/dashboard/leads')
  await page.locator('header select').selectOption(property)
  await page.getByText('Outcome Fixture',{exact:true}).click()
  await page.getByRole('button',{name:/^Tours/}).click()
  await page.getByRole('button',{name:'Record outcome',exact:true}).click()
}
test('records a real tour outcome from the console and survives reload', async ({page,fixture},info) => {
  await openTour(page,fixture.property)
  await page.getByLabel('Outcome notes (optional)').fill('Visited the model home.')
  await page.getByRole('button',{name:'Save outcome',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'Tour outcome saved.'})).toBeVisible()
  await expect(page.getByText('Configured follow-ups are queued; delivery is not yet confirmed.',{exact:false})).toBeVisible()
  await expect(page.getByRole('button',{name:'Record outcome',exact:true})).toHaveCount(0)
  expect((await fixture.db.from('tour_outcomes').select('*').eq('tour_id',fixture.tour)).data).toHaveLength(1)
  expect((await fixture.db.from('leads').select('status').eq('id',fixture.lead).single()).data?.status).toBe('toured')
  await page.screenshot({path:info.outputPath('tour-outcome-desktop.png')})
  await page.reload()
  await page.getByText('Outcome Fixture',{exact:true}).click()
  await page.getByRole('button',{name:/^Tours/}).click()
  await expect(page.getByText('Completed',{exact:true})).toBeVisible()
  await expect(page.getByText('Outcome notes: Visited the model home.',{exact:true})).toBeVisible()
})
test('keeps a failed save reviewable and retries once at mobile width', async ({page,fixture},info) => {
  await page.setViewportSize({width:390,height:844})
  let fail=true
  await page.route(`**/api/leads/${fixture.lead}/tours`,async route => {
    if (route.request().method()==='PATCH' && fail) {fail=false;return route.fulfill({status:503,json:{error:'The outcome could not be saved. Please retry.'}})}
    return route.continue()
  })
  await openTour(page,fixture.property)
  await page.getByLabel('Tour outcome',{exact:true}).selectOption('no_show')
  await page.getByRole('button',{name:'Save outcome',exact:true}).click()
  await expect(page.getByRole('form',{name:'Record tour outcome'}).getByRole('alert')).toContainText('Please retry')
  await expect(page.getByRole('button',{name:'Save outcome',exact:true})).toBeEnabled()
  await page.screenshot({path:info.outputPath('tour-outcome-mobile-retry.png')})
  await page.getByRole('button',{name:'Save outcome',exact:true}).click()
  await expect(page.getByText('No follow-up workflow is configured for this outcome.',{exact:false})).toBeVisible()
  await expect(page.getByText('No Show',{exact:true})).toBeVisible()
  expect((await fixture.db.from('tour_outcomes').select('id').eq('tour_id',fixture.tour)).data).toHaveLength(1)
})
test('real API concurrent retries produce one widget completion and one follow-up',async ({page,request,fixture}) => {
  const booking=randomUUID()
  const earlier=new Date(Date.parse(`${fixture.date}T${fixture.time}:00Z`)-3600000).toISOString()
  const inserted=await fixture.db.from('tour_bookings').insert({id:booking,property_id:fixture.property,lead_id:fixture.lead,scheduled_date:earlier.slice(0,10),scheduled_time:earlier.slice(11,16),status:'confirmed'})
  expect(inserted.error).toBeNull()
  expect((await request.post('/api/tours/complete',{data:{tourId:booking,requestId:booking}})).status()).toBe(401)
  const responses=await Promise.all([page.request.post('/api/tours/complete',{data:{tourId:booking,requestId:booking}}),page.request.post('/api/tours/complete',{data:{tourId:booking,requestId:booking}})])
  expect(responses.map(response=>response.status())).toEqual([200,200])
  const bodies=await Promise.all(responses.map(response=>response.json()))
  expect(bodies.filter(body=>body.replayed)).toHaveLength(1)
  expect(bodies[0].tour.completedAt).toBe(bodies[1].tour.completedAt)
  expect((await fixture.db.from('lead_workflows').select('id').eq('lead_id',fixture.lead)).data).toHaveLength(1)
  expect((await fixture.db.from('lead_engagement_events').select('id').eq('lead_id',fixture.lead)).data).toHaveLength(1)
  expect((await page.request.patch(`/api/leads/${fixture.lead}/tours`,{data:{tourId:booking,status:'no_show',requestId:randomUUID()}})).status()).toBe(409)
  expect((await page.request.post('/api/tours/complete',{data:'{bad',headers:{'content-type':'application/json'}})).status()).toBe(400)
  expect((await page.request.get('/api/tours/noshow?propertyId=99999999-9999-4999-8999-999999999999')).status()).toBe(403)
  const stats=await page.request.get(`/api/tours/noshow?propertyId=${fixture.property}`)
  expect(stats.status()).toBe(200)
  expect((await stats.json()).stats).toMatchObject({totalNoShows:0,followupsSent:0,followupsQueued:0})
})

test('a delayed workflow read cannot interrupt editing or overwrite a saved tour outcome',async({page,fixture})=>{
 const releases:Array<()=>void>=[]
 await page.route(`**/api/leads/${fixture.lead}/workflow`,async route=>{
  const response=await route.fetch()
  await new Promise<void>(resolve=>releases.push(resolve))
  await route.fulfill({response})
 })
 try {
  await openTour(page,fixture.property)
  await page.getByLabel('Outcome notes (optional)').fill('Saved while another panel was loading.')
  await page.getByRole('button',{name:'Save outcome',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'Tour outcome saved.'})).toBeVisible()
  for(const release of releases)release()
  await expect(page.getByText('Completed',{exact:true})).toBeVisible()
  expect((await fixture.db.from('tour_outcomes').select('id').eq('tour_id',fixture.tour)).data).toHaveLength(1)
 } finally {for(const release of releases)release();await page.unrouteAll({behavior:'ignoreErrors'})}
})
