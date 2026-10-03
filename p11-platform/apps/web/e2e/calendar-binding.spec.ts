import {expect,test as base} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const url=process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:9430',databaseURL=process.env.NEXT_PUBLIC_SUPABASE_URL||''
const local=['localhost','127.0.0.1'],client=()=>createClient(databaseURL,process.env.SUPABASE_SERVICE_ROLE_KEY!)
base.skip(!local.includes(new URL(url).hostname),'Local fixture only')
type Fixture={property:string;booking:string;event:string;calendar:string;actor:string;observedAt:string;remote:{id:string;status:string;startDateTime:string;endDateTime:string};db:ReturnType<typeof client>}
const test=base.extend<{fixture:Fixture}>({fixture:async({},provide)=>{
 if(!databaseURL||!local.includes(new URL(databaseURL).hostname))throw new Error('Local database required')
 const db=client(),property=randomUUID(),lead=randomUUID(),booking=randomUUID(),event=randomUUID(),calendar=randomUUID(),observedAt=new Date().toISOString()
 const day=new Date(Date.now()+7*86400000).toISOString().slice(0,10),remote={id:'fixture-event',status:'confirmed',startDateTime:`${day}T15:00:00.000Z`,endDateTime:`${day}T15:30:00.000Z`}
 const save=async(query:PromiseLike<{error:unknown}>)=>{const r=await query;if(r.error)throw r.error}
 try{
  const profile=await db.from('profiles').select('id').eq('org_id','22222222-2222-2222-2222-222222222222').limit(1).single();if(profile.error)throw profile.error
  await save(db.from('properties').insert({id:property,name:'Calendar review browser fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{timezone:'America/Chicago'}}))
  await save(db.from('lumaleasing_config').insert({property_id:property,api_key:`local-fixture-${property}`,timezone:'America/Chicago'}))
  await save(db.from('leads').insert({id:lead,property_id:property,first_name:'Calendar',last_name:'Guest',status:'tour_booked'}))
  await save(db.from('agent_calendars').insert({id:calendar,profile_id:profile.data.id,property_id:property,provider:'google',calendar_id:'fixture-calendar',google_email:'calendar@example.invalid',account_email:'calendar@example.invalid',access_token:'local-fixture-only',refresh_token:'local-fixture-only',token_expires_at:'2099-01-01T00:00:00Z',token_status:'healthy',scopes:['https://www.googleapis.com/auth/calendar'],provider_metadata:{scopeEvidence:'provider_response'},timezone:'America/Chicago',buffer_minutes:0,sync_enabled:true}))
  await save(db.from('tour_bookings').insert({id:booking,property_id:property,lead_id:lead,scheduled_date:day,scheduled_time:'10:00',duration_minutes:30,status:'confirmed',schedule_timezone:'America/Chicago'}))
  await provide({property,booking,event,calendar,actor:profile.data.id,observedAt,remote,db})
 }finally{
  await save(db.from('leads').delete().eq('id',lead))
  execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
  expect((await db.from('properties').select('id').eq('id',property)).data).toHaveLength(0)
 }
}})
test.beforeEach(async({page})=>{
 await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/)
})
async function open(page:import('@playwright/test').Page,property:string){
 await page.goto('/dashboard/lumaleasing');await page.locator('header select').selectOption(property);await page.getByRole('button',{name:'Configuration',exact:true}).click();await page.getByRole('button',{name:'Tours',exact:true}).click();await page.getByRole('region',{name:'Link existing calendar event'}).scrollIntoViewIfNeeded()
}

async function bind(f:Fixture,body:Record<string,unknown>){const r=await f.db.rpc('bind_tour_calendar_event',{p_property_id:f.property,p_booking_id:f.booking,p_actor_id:f.actor,p_request_id:body.requestId,p_version:body.version,p_calendar_id:f.calendar,p_credential_version:1,p_provider_event_id:f.remote.id,p_reason:body.reason,p_verified_at:new Date().toISOString(),p_remote:f.remote});if(r.error)throw r.error;return r.data}
const listed=(f:Fixture,events:unknown[],nextCursor:string|null=null)=>({state:'listed',calendarId:f.calendar,credentialVersion:1,timezone:'America/Chicago',events,nextCursor,unsupported:0})
test('finds an existing event across pages and recovers a lost link response',async({page,fixture},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let lost=true;const ids:string[]=[]
 await page.route('**/api/lumaleasing/tours/calendar-binding',async route=>{const body=route.request().postDataJSON();if(body.action==='list')return route.fulfill({json:listed(fixture,body.cursor?[{...fixture.remote,title:'Confirmed tour with Calendar Guest'}]:[],body.cursor?null:'fixture-next-page')});ids.push(body.requestId);const r=await bind(fixture,body);if(lost){lost=false;expect(r.state).toBe('applied');return route.fulfill({status:503,json:{error:'Link saved; response lost. Retry the same selection.'}})}expect(r.state).toBe('replayed');return route.fulfill({json:r})})
 await open(page,fixture.property);const section=page.getByRole('region',{name:'Link existing calendar event'});await section.getByRole('button',{name:'Find matching events'}).click();await expect(section).toContainText('No matching event on this page');await section.getByRole('button',{name:'Load more calendar events'}).click()
 await section.getByLabel('Matching calendar event').selectOption(fixture.remote.id);await section.getByLabel('Reason for linking').fill('Confirmed this is the existing guest tour');await section.getByRole('button',{name:'Link selected event'}).click();await expect(section.getByRole('alert')).toContainText('response lost');await section.getByRole('button',{name:'Link selected event'}).click();await expect(section).toHaveCount(0)
 await expect(page.getByText('Existing calendar event linked. No new event or prospect message was sent.',{exact:true})).toBeVisible();expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1])
 expect((await fixture.db.from('calendar_events').select('provider_event_id,sync_status,observed_schedule_version').eq('tour_booking_id',fixture.booking)).data).toEqual([{provider_event_id:fixture.remote.id,sync_status:'synced',observed_schedule_version:1}])
 expect((await fixture.db.from('tour_schedule_work').select('id').eq('tour_id',fixture.booking)).data).toEqual([])
 await page.goto('/dashboard/activity');await page.getByLabel('Product',{exact:true}).selectOption('tourspark');await expect(page.getByRole('heading',{name:'Linked existing calendar event',exact:true})).toHaveCount(1);await expect(page.getByRole('region',{name:'Recorded activity'})).toContainText('No calendar event linked');expect(errors).toEqual([]);await page.screenshot({path:info.outputPath('calendar-linked-history.png'),fullPage:true})
})
test('shows lookup failure and retries without inventing an empty calendar',async({page,fixture},info)=>{
 let unavailable=true
 await page.route('**/api/lumaleasing/tours/calendar-binding',async route=>unavailable?route.fulfill({status:503,json:{error:'Calendar lookup is temporarily unavailable.'}}):route.fulfill({json:listed(fixture,[{...fixture.remote,title:'Existing guest tour'}])}))
 await open(page,fixture.property);const section=page.getByRole('region',{name:'Link existing calendar event'});await section.getByRole('button',{name:'Find matching events'}).click();await expect(section.getByRole('alert')).toContainText('unavailable');await expect(section).not.toContainText('No matching event found')
 unavailable=false;await section.getByRole('button',{name:'Find matching events'}).click();await expect(section.getByLabel('Matching calendar event')).toBeVisible();await expect(section.getByRole('button',{name:'Link selected event'})).toBeDisabled();await page.screenshot({path:info.outputPath('calendar-link-selection.png'),fullPage:true})
})
test('real API rejects a stale selection after another operator links the event',async({page,fixture})=>{
 await page.route('**/api/lumaleasing/tours/calendar-binding',async route=>route.request().postDataJSON().action==='list'?route.fulfill({json:listed(fixture,[{...fixture.remote,title:'Existing guest tour'}])}):route.continue())
 await open(page,fixture.property);const section=page.getByRole('region',{name:'Link existing calendar event'});await section.getByRole('button',{name:'Find matching events'}).click();await section.getByLabel('Matching calendar event').selectOption(fixture.remote.id);await section.getByLabel('Reason for linking').fill('Selected this guest event')
 expect((await bind(fixture,{requestId:randomUUID(),version:1,reason:'Other operator linked this event'})).state).toBe('applied')
 await section.getByRole('button',{name:'Link selected event'}).click();await expect(section.getByRole('alert')).toContainText('already has a calendar link');await expect(section.getByRole('button',{name:'Link selected event'})).toBeDisabled();await expect(section.getByLabel('Reason for linking')).toHaveValue('Selected this guest event')
 expect((await fixture.db.from('calendar_events').select('id').eq('tour_booking_id',fixture.booking)).data).toHaveLength(1)
})
