import {expect, test as base} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430'
const databaseURL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const local = ['localhost','127.0.0.1']
const createFixtureClient = () => createClient(databaseURL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
base.skip(!local.includes(new URL(baseURL).hostname), 'Local fixtures only')
const test = base.extend<{fixture: {property: string; lead: string; tour: string; db: ReturnType<typeof createFixtureClient>; date: string}}>({
  fixture: async ({}, provideFixture) => {
    if (!databaseURL || !local.includes(new URL(databaseURL).hostname)) throw new Error('A local database is required')
    const db=createFixtureClient()
    const property=randomUUID(), lead=randomUUID(), tour=randomUUID()
    const date=new Date(Date.now()-86400000).toISOString().slice(0,10)
    async function save(query: PromiseLike<{error: unknown}>) {const result=await query; if(result.error) throw result.error}
    try {
      await save(db.from('properties').insert({id:property,name:'Tour action browser fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{timezone:'UTC'}}))
      await save(db.from('leads').insert({id:lead,property_id:property,first_name:'Outcome',last_name:'Fixture',email:'tour-outcome@example.invalid',source:'manual',status:'tour_booked'}))
      await save(db.from('tours').insert({id:tour,property_id:property,lead_id:lead,tour_date:date,tour_time:'10:00',status:'confirmed'}))
      await save(db.from('workflow_definitions').insert({property_id:property,name:'Local outcome follow-up',trigger_on:'tour_completed',steps:[{action:'email',template_slug:'local-only',delay_hours:8760}],exit_conditions:['leased','lost']}))
      await provideFixture({property,lead,tour,db,date})
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
test('a lost outcome response retries one decision and appears in shared activity',async({page,fixture},info)=>{
 const ids:string[]=[];let lose=true
 await page.route(`**/api/leads/${fixture.lead}/tours`,async route=>{
  if(route.request().method()!=='PATCH')return route.continue()
  ids.push(route.request().postDataJSON().requestId)
  if(lose){lose=false;const saved=await route.fetch();expect(saved.status()).toBe(200);return route.fulfill({status:503,json:{error:'The saved response was lost. Retry the same request.'}})}
  return route.continue()
 })
 await openTour(page,fixture.property)
 await page.getByLabel('Outcome notes (optional)').fill('Private attendance note stays in the tour record.')
 await page.getByRole('button',{name:'Save outcome',exact:true}).click()
 await expect(page.getByRole('form',{name:'Record tour outcome'}).getByRole('alert')).toContainText('response was lost')
 await page.getByRole('button',{name:'Save outcome',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Tour outcome saved.'})).toBeVisible()
 expect(ids).toHaveLength(2);expect(ids[1]).toBe(ids[0])
 const events=await fixture.db.from('shared_action_events').select('*').eq('property_id',fixture.property).eq('action','tour.outcome.recorded')
 expect(events.error).toBeNull();expect(events.data).toHaveLength(1)
 expect(events.data![0]).toMatchObject({id:ids[0],evidence:'server_confirmed',phase:'succeeded',before_state:{status:'confirmed'},after_state:{status:'completed'},training_eligible:false})
 expect(JSON.stringify(events.data)).not.toContain('Private attendance note')
 await page.goto('/dashboard/activity');await page.locator('header select').selectOption(fixture.property)
 await expect(page.getByRole('heading',{name:'Recorded tour outcome',exact:true})).toBeVisible()
 await expect(page.getByText(/confirmed.*→.*completed/)).toBeVisible()
 await page.screenshot({path:info.outputPath('tour-action-history-desktop.png')})
})
test('missing request identity cannot mutate a tour',async({page,fixture})=>{
 const response=await page.request.patch(`/api/leads/${fixture.lead}/tours`,{data:{tourId:fixture.tour,status:'completed'}})
 expect(response.status()).toBe(400)
 expect((await fixture.db.from('tours').select('status').eq('id',fixture.tour).single()).data?.status).toBe('confirmed')
 expect((await fixture.db.from('shared_action_events').select('id').eq('property_id',fixture.property).eq('action','tour.outcome.recorded')).data).toHaveLength(0)
})
