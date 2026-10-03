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

async function queueNotice(page:import('@playwright/test').Page,fixture:{tour:string;db:ReturnType<typeof createFixtureClient>;lead:string}) {
 const changed=await page.request.patch(`/api/leads/${fixture.lead}/tours`,{data:change(fixture.tour)})
 expect(changed.status()).toBe(200)
 const job=await fixture.db.from('tour_schedule_work').select('*').eq('tour_id',fixture.tour).eq('kind','notice_email').single()
 expect(job.error).toBeNull();return job.data!
}
async function openHistory(page:import('@playwright/test').Page,property:string) {
 await openTour(page,property)
 await page.getByRole('button',{name:'Tour change delivery +',exact:true}).click()
 return page.getByRole('region',{name:'Tour change delivery'})
}
test('lost review response recovers one provider receipt and one recorded operator action',async({page,fixture},info)=>{
 const job=await queueNotice(page,fixture)
 const claim=await fixture.db.rpc('claim_tour_schedule_work',{p_id:job.id});expect(claim.error).toBeNull()
 const start=await fixture.db.rpc('start_tour_schedule_delivery',{p_id:job.id,p_token:claim.data.lease_token,p_dispatch:{to:job.payload.email,from:'fixture@example.invalid',subject:'Fixture only',body:'No provider call'}});expect(start.error).toBeNull();expect(start.data).toBeTruthy()
 expect((await fixture.db.rpc('finish_tour_schedule_work',{p_id:job.id,p_token:claim.data.lease_token,p_success:false,p_receipt:{error:'Fixture ambiguity'}})).data).toBe(true)
 const region=await openHistory(page,fixture.property)
 const form=region.getByRole('form',{name:'Review Email notice'})
 await form.getByLabel('Provider message ID').fill('verified-fixture-receipt')
 await form.getByLabel('Review evidence').fill('Provider history checked for this tour change')
 let lose=true;const ids:string[]=[]
 await page.route('**/api/tours/schedule-delivery/recovery',async route=>{
  if(route.request().method()!=='POST')return route.continue()
  ids.push(route.request().postDataJSON().requestId)
  if(lose){lose=false;const response=await route.fetch();expect(response.status()).toBe(200);return route.fulfill({status:503,json:{error:'The review save is unconfirmed. Retry the same review safely.'}})}
  return route.continue()
 })
 await form.getByRole('button',{name:'Save update review'}).click()
 await expect(form.getByRole('status')).toContainText('unconfirmed')
 await form.getByRole('button',{name:'Save update review'}).click()
 await expect(region.getByText('Accepted by provider',{exact:true})).toBeVisible()
 await expect(region.getByText('Provider receipt: verified-fixture-receipt',{exact:true})).toBeVisible()
 expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1])
 expect((await fixture.db.from('tour_schedule_reviews').select('id').eq('work_id',job.id)).data).toHaveLength(1)
 const actions=await fixture.db.from('shared_action_events').select('phase,result,training_eligible').eq('property_id',fixture.property).eq('action','tour.schedule_delivery.reviewed')
 expect(actions.data).toEqual([{phase:'succeeded',result:expect.objectContaining({outcomeEvidence:'operator_review'}),training_eligible:false}])
 expect((await fixture.db.from('tour_schedule_work').select('attempts').eq('id',job.id).single()).data?.attempts).toBe(1)
 await page.screenshot({path:info.outputPath('tour-change-reconciled-desktop.png')})
 await page.reload();await page.getByText('Schedule Fixture',{exact:true}).click();await page.getByRole('button',{name:/^Tours/}).click();await page.getByRole('button',{name:'Tour change delivery +',exact:true}).click()
 await expect(page.getByText('Provider receipt: verified-fixture-receipt',{exact:true})).toBeVisible()
})
test('expired unattempted notice closes as not sent and never requeues stale work',async({page,fixture},info)=>{
 await page.setViewportSize({width:390,height:844})
 const job=await queueNotice(page,fixture)
 expect((await fixture.db.from('tour_schedule_work').update({created_at:new Date(Date.now()-86400000).toISOString()}).eq('id',job.id)).error).toBeNull()
 expect((await fixture.db.rpc('claim_tour_schedule_work',{p_id:job.id})).data).toBeNull()
 const region=await openHistory(page,fixture.property),form=region.getByRole('form',{name:'Review Email notice'})
 await expect(form.getByRole('option',{name:'Provider accepted the update'})).toHaveCount(0)
 await form.getByLabel('Review evidence').fill('This old notice never crossed the provider boundary')
 await form.getByRole('button',{name:'Save update review'}).click()
 await expect(region.getByText('Not sent',{exact:true})).toBeVisible()
 await expect(page.getByText('Some updates were not sent. Review the tour change delivery history.',{exact:true})).toBeVisible()
 expect((await fixture.db.from('tour_schedule_work').select('state,attempts').eq('id',job.id).single()).data).toEqual({state:'skipped',attempts:0})
 await page.screenshot({path:info.outputPath('tour-change-not-sent-mobile.png')})
})
test('calendar review rejects a different event and reconciles the pinned event atomically',async({page,fixture})=>{
 const booking=randomUUID(),calendar=randomUUID()
 expect((await fixture.db.from('agent_calendars').insert({id:calendar,property_id:fixture.property,account_email:'calendar@example.invalid',provider:'google',calendar_id:'fixture-calendar',timezone:'UTC',sync_enabled:false})).error).toBeNull()
 expect((await fixture.db.from('tour_bookings').insert({id:booking,property_id:fixture.property,lead_id:fixture.lead,scheduled_date:future(3),scheduled_time:'13:00',status:'confirmed'})).error).toBeNull()
 expect((await fixture.db.from('calendar_events').insert({agent_calendar_id:calendar,tour_booking_id:booking,google_event_id:'pinned-fixture-event',provider_event_id:'pinned-fixture-event',sync_status:'synced'})).error).toBeNull()
 const response=await page.request.patch(`/api/leads/${fixture.lead}/tours`,{data:{...change(booking),notify:false}});expect(response.status()).toBe(200)
 const job=await fixture.db.from('tour_schedule_work').select('id').eq('tour_id',booking).eq('kind','calendar').single();expect(job.error).toBeNull()
 const claim=await fixture.db.rpc('claim_tour_schedule_work',{p_id:job.data!.id});expect(claim.error).toBeNull()
 expect((await fixture.db.rpc('start_tour_schedule_delivery',{p_id:job.data!.id,p_token:claim.data.lease_token,p_dispatch:{}})).data).toBeTruthy()
 expect((await fixture.db.rpc('finish_tour_schedule_work',{p_id:job.data!.id,p_token:claim.data.lease_token,p_success:false,p_receipt:{error:'Fixture ambiguity'}})).data).toBe(true)
 const region=await openHistory(page,fixture.property),form=region.getByRole('form',{name:'Review Calendar change'})
 await expect(form.getByLabel('Provider event ID')).toHaveValue('pinned-fixture-event')
 await form.getByLabel('Provider event ID').fill('wrong-event')
 await form.getByLabel('Review evidence').fill('Calendar event was inspected')
 await form.getByRole('button',{name:'Save update review'}).click()
 await expect(form.getByRole('status')).toContainText('saved calendar event ID')
 await form.getByLabel('Provider event ID').fill('pinned-fixture-event')
 await form.getByRole('button',{name:'Save update review'}).click()
 await expect(region.getByText('Accepted by provider',{exact:true})).toBeVisible()
 expect((await fixture.db.from('calendar_events').select('sync_status,provider_event_id').eq('tour_booking_id',booking)).data).toEqual([{sync_status:'synced',provider_event_id:'pinned-fixture-event'}])
 expect((await fixture.db.from('shared_action_events').select('phase').eq('property_id',fixture.property).eq('action','tour.schedule_delivery.reviewed')).data?.map(e=>e.phase).sort()).toEqual(['failed','succeeded'])
})
