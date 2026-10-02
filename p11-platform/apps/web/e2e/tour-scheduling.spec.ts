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
    const date=new Date(Date.now()+172800000).toISOString().slice(0,10)
    async function save(query: PromiseLike<{error: unknown}>) {const result=await query; if(result.error) throw result.error}
    try {
      await save(db.from('properties').insert({id:property,name:'Tour scheduling browser fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{timezone:'UTC'}}))
      await save(db.from('leads').insert({id:lead,property_id:property,first_name:'Schedule',last_name:'Fixture',email:'tour-outcome@example.invalid',source:'manual',status:'tour_booked'}))
      await save(db.from('tours').insert({id:tour,property_id:property,lead_id:lead,tour_date:date,tour_time:'10:00',status:'confirmed'}))
      await save(db.from('workflow_definitions').insert({property_id:property,name:'Local outcome follow-up',trigger_on:'tour_completed',steps:[{action:'email',template_slug:'local-only',delay_hours:8760}],exit_conditions:['leased','lost']}))
      await save(db.from('workflow_definitions').insert({property_id:property,name:'Local no-show follow-up',trigger_on:'tour_no_show',steps:[{action:'email',template_slug:'local-only',delay_hours:8760}],exit_conditions:['leased','lost']}))

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
async function openTour(page: import('@playwright/test').Page,property:string) {
 await page.goto('/dashboard/leads');await page.locator('header select').selectOption(property)
 await page.getByText('Schedule Fixture',{exact:true}).click();await page.getByRole('button',{name:/^Tours/}).click()
}
const future=(days:number)=>new Date(Date.now()+days*86400000).toISOString().slice(0,10)
const change=(tourId:string,expectedVersion=1)=>({tourId,expectedVersion,requestId:randomUUID(),action:'reschedule',date:future(4),time:'11:00',reason:'Prospect requested a later visit',notify:true})
test('reschedules and cancels with persistent history and versioned queued updates',async({page,fixture},info)=>{
 await openTour(page,fixture.property);await page.getByRole('button',{name:'Reschedule',exact:true}).click()
 await expect(page.getByRole('button',{name:'Save new time',exact:true})).toBeDisabled()
 await page.getByLabel('New date').fill(future(4));await page.getByLabel('New time').fill('11:00');await page.getByLabel('Reason for change',{exact:true}).fill('Prospect requested a later visit')
 await page.getByLabel('Queue an update for the prospect').check();await page.getByRole('button',{name:'Save new time',exact:true}).click()
 await expect(page.getByText('Schedule updated',{exact:true})).toBeVisible();await expect(page.getByText('Calendar or prospect updates are pending.',{exact:true})).toBeVisible()
 const record=await fixture.db.from('tours').select('tour_date,tour_time,schedule_version').eq('id',fixture.tour).single()
 expect(record.data).toMatchObject({tour_date:future(4),tour_time:'11:00:00',schedule_version:2})
 await page.screenshot({path:info.outputPath('tour-schedule-desktop.png')})
 await page.reload();await page.getByText('Schedule Fixture',{exact:true}).click();await page.getByRole('button',{name:/^Tours/}).click()
 await expect(page.getByText('Prospect requested a later visit',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Cancel tour',exact:true}).click();await page.getByLabel('Reason for change',{exact:true}).fill('Prospect changed plans')
 await page.getByRole('button',{name:'Confirm cancellation',exact:true}).click()
 await expect(page.getByText('Cancellation recorded',{exact:true})).toBeVisible()
 expect((await fixture.db.from('tours').select('status,schedule_version').eq('id',fixture.tour).single()).data).toEqual({status:'cancelled',schedule_version:3})
 expect((await fixture.db.from('leads').select('status').eq('id',fixture.lead).single()).data!.status).toBe('contacted')
 expect((await fixture.db.from('tour_schedule_work').select('state').eq('tour_id',fixture.tour)).data).toEqual([{state:'superseded'}])
 expect((await fixture.db.from('tour_schedule_changes').select('id').eq('tour_id',fixture.tour)).data).toHaveLength(2)
})
test('mobile capacity failure remains editable and a lost successful response retries once',async({page,fixture},info)=>{
 await page.setViewportSize({width:390,height:844})
 expect((await fixture.db.from('tour_bookings').insert({property_id:fixture.property,lead_id:fixture.lead,scheduled_date:future(4),scheduled_time:'11:00',status:'confirmed'})).error).toBeNull()
 await openTour(page,fixture.property);await page.getByRole('button',{name:'Reschedule',exact:true}).first().click()
 await page.getByLabel('New date').fill(future(4));await page.getByLabel('New time').fill('11:00');await page.getByLabel('Reason for change',{exact:true}).fill('Mobile retry fixture')
 await page.getByRole('button',{name:'Save new time',exact:true}).click();await expect(page.getByRole('form',{name:'Reschedule tour'}).getByRole('alert')).toContainText('no longer available')
 expect((await fixture.db.from('tours').select('schedule_version').eq('id',fixture.tour).single()).data!.schedule_version).toBe(1)
 await page.getByLabel('New time').fill('12:00')
 const ids:string[]=[];let first=true
 await page.route(`**/api/leads/${fixture.lead}/tours`,async route=>{
  if(route.request().method()!=='PATCH'){await route.continue();return}
  ids.push(route.request().postDataJSON().requestId)
  if(first){first=false;expect((await route.fetch()).status()).toBe(200);await route.abort('failed');return}await route.continue()
 })
 await page.getByRole('button',{name:'Save new time',exact:true}).click();await expect(page.getByRole('form',{name:'Reschedule tour'}).getByRole('alert')).toContainText('unconfirmed')
 await page.screenshot({path:info.outputPath('tour-schedule-mobile-retry.png')})
 await page.getByRole('button',{name:'Save new time',exact:true}).click();await expect(page.getByText('Schedule updated',{exact:true})).toBeVisible()
 expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);expect((await fixture.db.from('tour_schedule_changes').select('id').eq('tour_id',fixture.tour)).data).toHaveLength(1)
})
test('real API protects in-flight reminders and preserves a leased lead on cancellation',async({page,request,fixture})=>{
 const body={...change(fixture.tour),action:'cancel',date:undefined,time:undefined,notify:false}
 expect((await request.patch(`/api/leads/${fixture.lead}/tours`,{data:body})).status()).toBe(401)
 const claim=await fixture.db.rpc('claim_tour_legacy_delivery',{p_property_id:fixture.property,p_source:'tours',p_tour_id:fixture.tour,p_version:1,p_kind:'reminder_24h'})
 expect(claim.error).toBeNull();expect(claim.data?.lease_token).toBeTruthy()
 const busy=await page.request.patch(`/api/leads/${fixture.lead}/tours`,{data:body});expect(busy.status()).toBe(409);expect((await busy.json()).code).toBe('delivery_busy')
 expect((await fixture.db.from('tour_schedule_work').update({lease_until:new Date(Date.now()-60000).toISOString()}).eq('id',claim.data.id)).error).toBeNull()
 const review=await page.request.patch(`/api/leads/${fixture.lead}/tours`,{data:body});expect(review.status()).toBe(409);expect((await review.json()).code).toBe('delivery_review_required')
 expect((await fixture.db.rpc('finish_tour_schedule_work',{p_id:claim.data.id,p_token:claim.data.lease_token,p_success:true,p_receipt:{messageId:'local-test-receipt'}})).data).toBe(true)
 expect((await fixture.db.from('leads').update({status:'leased'}).eq('id',fixture.lead)).error).toBeNull()
 const saved=await page.request.patch(`/api/leads/${fixture.lead}/tours`,{data:body});expect(saved.status()).toBe(200);expect((await saved.json()).leadStatus).toBe('leased')
 expect((await page.request.patch(`/api/leads/${fixture.lead}/tours`,{data:body})).status()).toBe(200)
 expect((await fixture.db.from('tour_schedule_changes').select('id').eq('tour_id',fixture.tour)).data).toHaveLength(1)
})
test('concurrent widget edits have one winner and recovery uses the same retry contract',async({page,fixture})=>{
 const booking=randomUUID()
 expect((await fixture.db.from('tour_bookings').insert({id:booking,lead_id:fixture.lead,property_id:fixture.property,scheduled_date:future(3),scheduled_time:'13:00',status:'confirmed'})).error).toBeNull()
 const body=change(booking)
 const results=await Promise.all([page.request.patch(`/api/leads/${fixture.lead}/tours`,{data:body}),page.request.patch(`/api/leads/${fixture.lead}/tours`,{data:{...body,requestId:randomUUID(),time:'12:00'}})])
 expect(results.map(r=>r.status()).sort()).toEqual([200,409]);expect((await fixture.db.from('tour_schedule_changes').select('id').eq('tour_id',booking)).data).toHaveLength(1)
 const cancel={propertyId:fixture.property,bookingId:booking,requestId:randomUUID(),expectedVersion:2,action:'cancel',reason:'Recovery panel cancellation'}
 const saved=await page.request.post('/api/lumaleasing/tours/recovery',{data:cancel});expect(saved.status()).toBe(200)
 const replay=await page.request.post('/api/lumaleasing/tours/recovery',{data:cancel});expect(replay.status()).toBe(200);expect((await replay.json()).state).toBe('replayed')
 expect((await fixture.db.from('leads').select('status').eq('id',fixture.lead).single()).data!.status).toBe('tour_booked')
})

test('a late response from the previous property cannot replace the current lead list',async({page,fixture})=>{
 let release!:()=>void,received!:()=>void,finished!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve}),arrived=new Promise<void>(resolve=>{received=resolve}),done=new Promise<void>(resolve=>{finished=resolve})
 await page.route('**/api/leads?**',async route=>{
  if(new URL(route.request().url()).searchParams.get('propertyId')===fixture.property){await route.continue();return}
  const response=await route.fetch();received();await gate
  try{await route.fulfill({response})}catch{/* The superseded browser request was deliberately aborted. */}finally{finished()}
 })
 await page.goto('/dashboard/leads');await arrived
 await page.locator('header select').selectOption(fixture.property)
 await expect(page.getByText('Schedule Fixture',{exact:true})).toBeVisible()
 release();await done
 await expect(page.getByText('Schedule Fixture',{exact:true})).toBeVisible()
 await expect(page.getByText('Jordan Prospect',{exact:true})).toHaveCount(0)
})
