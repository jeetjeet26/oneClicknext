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
      await save(db.from('properties').insert({id:property,name:'Console booking browser fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{timezone:'UTC'}}))
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
async function openBooking(page:import('@playwright/test').Page,property:string) {
 await page.goto('/dashboard/leads');await page.locator('header select').selectOption(property)
 await page.getByText('Outcome Fixture',{exact:true}).click();await page.getByRole('button',{name:/^Tours/}).click()
 await page.getByRole('button',{name:'New Tour',exact:true}).click()
 await expect(page.getByRole('dialog',{name:'Schedule tour'})).toBeVisible()
}
test('lost booking response recovers one reservation and clearly reports paused confirmation',async({page,fixture},info)=>{
 await page.setViewportSize({width:390,height:844});const ids:string[]=[];let lose=true
 await page.route(`**/api/leads/${fixture.lead}/tours`,async route=>{
  if(route.request().method()!=='POST')return route.continue()
  ids.push(route.request().postDataJSON().requestId)
  if(lose){lose=false;const saved=await route.fetch();expect(saved.status()).toBe(201);return route.fulfill({status:503,json:{error:'The booking response was lost. Retry the same request.'}})}
  return route.continue()
 })
 await openBooking(page,fixture.property)
 await expect(page.getByText('Date and time use UTC.',{exact:false})).toBeVisible()
 await page.getByLabel('Tour date',{exact:true}).fill(new Date(Date.now()+3*86400000).toISOString().slice(0,10))
 await page.getByRole('button',{name:'Save booking',exact:true}).click()
 await expect(page.getByRole('form',{name:'Schedule new tour'}).getByRole('alert')).toContainText('response was lost')
 await page.getByRole('button',{name:'Save booking',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Booking recovered'})).toBeVisible()
 await expect(page.getByRole('dialog').getByRole('status')).toContainText('Confirmation is queued. Outbound delivery is currently paused.')
 expect(ids).toHaveLength(2);expect(ids[1]).toBe(ids[0])
 await page.screenshot({path:info.outputPath('booking-recovered-mobile.png')})
 const events=await fixture.db.from('shared_action_events').select('id,result').eq('property_id',fixture.property).eq('action','tour.booked').eq('phase','succeeded')
 expect(events.error).toBeNull();expect(events.data).toHaveLength(1)
 const booking=events.data![0].result.tourId
 expect((await fixture.db.from('tours').select('id').eq('lead_id',fixture.lead)).data).toHaveLength(2)
 const work=await fixture.db.from('tour_schedule_work').select('id,state').eq('tour_id',booking).eq('kind','confirmation').single()
 expect(work.error).toBeNull();expect(work.data?.state).toBe('queued')
 expect((await fixture.db.from('tour_reminder_channels').select('state,attempts').eq('work_id',work.data!.id)).data).toEqual([{state:'queued',attempts:0}])
 await page.getByRole('button',{name:'Done',exact:true}).click()
 await page.getByRole('button',{name:'Tour message delivery +',exact:true}).click()
 await expect(page.getByText('Booking confirmation',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Tour message delivery'}).getByText('Queued',{exact:true})).toBeVisible()
 await page.reload();await page.getByText('Outcome Fixture',{exact:true}).click();await page.getByRole('button',{name:/^Tours/}).click()
 await page.getByRole('button',{name:'Tour message delivery +',exact:true}).click();await expect(page.getByText('Booking confirmation',{exact:true})).toBeVisible()
})
test('competing booking requests reserve one slot and record the rejected decision',async({page,fixture})=>{
 const body={tourDate:new Date(Date.now()+4*86400000).toISOString().slice(0,10),tourTime:'11:00',sendConfirmation:false}
 const responses=await Promise.all([page.request.post(`/api/leads/${fixture.lead}/tours`,{data:{...body,requestId:randomUUID()}}),page.request.post(`/api/leads/${fixture.lead}/tours`,{data:{...body,requestId:randomUUID()}})])
 expect(responses.map(r=>r.status()).sort()).toEqual([201,409])
 const events=await fixture.db.from('shared_action_events').select('phase').eq('property_id',fixture.property).eq('action','tour.booked')
 expect(events.data?.map(e=>e.phase).sort()).toEqual(['failed','succeeded'])
 expect((await fixture.db.from('tours').select('id').eq('lead_id',fixture.lead).eq('tour_date',body.tourDate)).data).toHaveLength(1)
})
test('missing timezone is visible before saving and the API also rejects it',async({page,fixture},info)=>{
 expect((await fixture.db.from('properties').update({settings:{}}).eq('id',fixture.property)).error).toBeNull()
 await openBooking(page,fixture.property)
 await expect(page.getByText('Set a valid property timezone before booking.',{exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Save booking',exact:true})).toBeDisabled()
 await page.screenshot({path:info.outputPath('booking-timezone-desktop.png')})
 const response=await page.request.post(`/api/leads/${fixture.lead}/tours`,{data:{requestId:randomUUID(),tourDate:new Date(Date.now()+86400000).toISOString().slice(0,10),tourTime:'10:00',sendConfirmation:false}})
 expect(response.status()).toBe(409);expect((await response.json()).code).toBe('needs_timezone')
 await page.getByLabel('Property timezone',{exact:true}).selectOption('America/New_York')
 await page.getByRole('button',{name:'Save property timezone',exact:true}).click()
 await expect(page.getByText('Date and time use America/New_York.',{exact:false})).toBeVisible()
 await expect(page.getByRole('button',{name:'Save booking',exact:true})).toBeEnabled()
 expect((await fixture.db.from('properties').select('settings').eq('id',fixture.property).single()).data?.settings.timezone).toBe('America/New_York')
 expect((await fixture.db.from('shared_action_events').select('id').eq('property_id',fixture.property).eq('action','tour.timezone.set')).data).toHaveLength(1)
})

test('a saved booking keeps its clock, calendar links and visible zone after property settings change',async({page,fixture},info)=>{
 const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10)
 const response=await page.request.post(`/api/leads/${fixture.lead}/tours`,{data:{requestId:randomUUID(),tourDate:date,tourTime:'10:00',sendConfirmation:false}})
 expect(response.status()).toBe(201);const saved=await response.json()
 expect(saved.tour.schedule_timezone).toBe('UTC')
 expect((await fixture.db.from('properties').update({settings:{timezone:'America/Los_Angeles'}}).eq('id',fixture.property)).error).toBeNull()
 const history=await page.request.get(`/api/leads/${fixture.lead}/tours`);expect(history.status()).toBe(200)
 const record=(await history.json()).tours.find((tour:{id:string})=>tour.id===saved.tour.id)
 expect(record.timezone).toBe('UTC');expect(Date.parse(record.starts_at)).toBe(Date.parse(`${date}T10:00:00Z`))
 expect(new URL(record.calendar.google).searchParams.get('dates')).toBe(`${date.replaceAll('-','')}T100000Z/${date.replaceAll('-','')}T103000Z`)
 await page.goto('/dashboard/leads');await page.locator('header select').selectOption(fixture.property)
 await page.getByText('Outcome Fixture',{exact:true}).click();await page.getByRole('button',{name:/^Tours/}).click()
 await expect(page.getByText('Active tours',{exact:true})).toBeVisible()
 const clock=page.getByText('10:00 AM · UTC',{exact:true});await expect(clock).toBeVisible();await clock.scrollIntoViewIfNeeded()
 await page.screenshot({path:info.outputPath('booked-timezone-console.png')})
})
