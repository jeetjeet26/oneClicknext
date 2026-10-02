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
 const day=new Date(Date.now()+7*86400000).toISOString().slice(0,10),remote={id:'fixture-event',status:'confirmed',startDateTime:`${day}T16:00:00.000Z`,endDateTime:`${day}T16:30:00.000Z`}
 const save=async(query:PromiseLike<{error:unknown}>)=>{const r=await query;if(r.error)throw r.error}
 try{
  const profile=await db.from('profiles').select('id').eq('org_id','22222222-2222-2222-2222-222222222222').limit(1).single();if(profile.error)throw profile.error
  await save(db.from('properties').insert({id:property,name:'Calendar review browser fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{timezone:'America/Chicago'}}))
  await save(db.from('lumaleasing_config').insert({property_id:property,api_key:`local-fixture-${property}`,timezone:'America/Chicago'}))
  await save(db.from('leads').insert({id:lead,property_id:property,first_name:'Calendar',last_name:'Guest',status:'tour_booked'}))
  await save(db.from('agent_calendars').insert({id:calendar,profile_id:profile.data.id,property_id:property,provider:'google',calendar_id:'fixture-calendar',google_email:'calendar@example.invalid',account_email:'calendar@example.invalid',access_token:'local-fixture-only',refresh_token:'local-fixture-only',token_expires_at:'2099-01-01T00:00:00Z',token_status:'healthy',scopes:['https://www.googleapis.com/auth/calendar'],provider_metadata:{scopeEvidence:'provider_response'},timezone:'America/Chicago',buffer_minutes:0,sync_enabled:true}))
  await save(db.from('tour_bookings').insert({id:booking,property_id:property,lead_id:lead,scheduled_date:day,scheduled_time:'10:00',duration_minutes:30,status:'confirmed',schedule_timezone:'America/Chicago'}))
  await save(db.from('calendar_events').insert({id:event,agent_calendar_id:calendar,tour_booking_id:booking,google_event_id:remote.id,provider_event_id:remote.id,sync_status:'external_drift',remote_snapshot:remote,observed_schedule_version:1,last_synced_at:observedAt}))
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
 await page.goto('/dashboard/lumaleasing');await page.locator('header select').selectOption(property);await page.getByRole('button',{name:'Configuration',exact:true}).click();await page.getByRole('button',{name:'Tours',exact:true}).click();await page.getByRole('region',{name:'Review calendar change'}).scrollIntoViewIfNeeded()
}
// Only the provider check is supplied as fixture evidence. The real decision transaction and read APIs persist and render its outcome.
async function apply(f:Fixture,body:Record<string,unknown>,remote:Fixture['remote']|null=f.remote){
 const r=await f.db.rpc('review_tour_calendar_change',{p_property_id:f.property,p_booking_id:f.booking,p_event_id:f.event,p_actor_id:f.actor,p_request_id:body.requestId,p_version:body.version,p_observed_at:body.observedAt,p_reason:body.reason,p_verified_at:new Date().toISOString(),p_verified_remote:remote,p_verified_calendar:{id:f.calendar,provider:'google',calendarId:'fixture-calendar',accountEmail:'calendar@example.invalid',credentialVersion:1},p_resolution:body.action==='restore'?'restore':'adopt'});if(r.error)throw r.error;return r.data
}
test('adopts calendar time and recovers a lost response as one recorded decision',async({page,fixture},info)=>{
 let lost=true;const ids:string[]=[]
 await page.route('**/api/lumaleasing/tours/calendar-review',async route=>{
  const body=route.request().postDataJSON();ids.push(body.requestId);const result=await apply(fixture,body)
  if(lost){lost=false;expect(result.state).toBe('applied');return route.fulfill({status:503,json:{error:'Response lost. Retry the same decision.'}})}
  expect(result.state).toBe('replayed');return route.fulfill({json:result})
 })
 await open(page,fixture.property)
 const review=page.getByRole('region',{name:'Review calendar change'})
 await expect(review).toContainText('America/Chicago');await expect(review.getByRole('button',{name:'Use calendar time'})).toBeDisabled()
 await review.getByLabel('Reason for calendar decision').fill('Verified the calendar move with the team')
 await review.getByRole('button',{name:'Use calendar time'}).click();await expect(review.getByRole('alert')).toHaveText('Response lost. Retry the same decision.')
 await review.getByRole('button',{name:'Use calendar time'}).click();await expect(page.getByText('Booking updated to match the calendar. No message was sent.',{exact:true})).toBeVisible()
 expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);await expect(review).toHaveCount(0)
 expect((await fixture.db.from('tour_bookings').select('scheduled_time,schedule_version').eq('id',fixture.booking).single()).data).toEqual({scheduled_time:'11:00:00',schedule_version:2})
 expect((await fixture.db.from('tour_schedule_work').select('state,receipt').eq('tour_id',fixture.booking)).data).toEqual([{state:'skipped',receipt:null}])
 await page.goto('/dashboard/activity');await page.getByLabel('Product',{exact:true}).selectOption('tourspark');await expect(page.getByRole('heading',{name:'Reviewed external calendar change',exact:true})).toHaveCount(1)
 await expect(page.getByRole('region',{name:'Recorded activity'})).toContainText('10:00');await expect(page.getByRole('region',{name:'Recorded activity'})).toContainText('11:00')
 await page.screenshot({path:info.outputPath('calendar-review-history.png'),fullPage:true})
})
test('stale observation is rejected by the real API and draft stays visible',async({page,fixture},info)=>{
 await open(page,fixture.property);const review=page.getByRole('region',{name:'Review calendar change'})
 await review.getByLabel('Reason for calendar decision').fill('My pending calendar decision')
 expect((await fixture.db.from('calendar_events').update({last_synced_at:new Date().toISOString()}).eq('id',fixture.event)).error).toBeNull()
 await review.getByRole('button',{name:'Use calendar time'}).click();await expect(review.getByRole('alert')).toContainText('changed');await expect(review.getByLabel('Reason for calendar decision')).toHaveValue('My pending calendar decision');await expect(review.getByRole('button',{name:'Use calendar time'})).toBeDisabled();await expect(review.getByRole('button',{name:'Check calendar again'})).toBeEnabled()
 expect((await fixture.db.from('tour_bookings').select('schedule_version').eq('id',fixture.booking).single()).data?.schedule_version).toBe(1)
 await page.screenshot({path:info.outputPath('calendar-stale-decision.png'),fullPage:true})
})
test('cancelled provider event requires an explicit recorded cancellation',async({page,fixture})=>{
 const remote={...fixture.remote,status:'cancelled'}
 expect((await fixture.db.from('calendar_events').update({sync_status:'external_cancelled',remote_snapshot:remote}).eq('id',fixture.event)).error).toBeNull()
 await page.route('**/api/lumaleasing/tours/calendar-review',async route=>route.fulfill({json:await apply(fixture,route.request().postDataJSON(),remote)}))
 await open(page,fixture.property);const review=page.getByRole('region',{name:'Review calendar change'})
 await expect(review).toContainText('Calendar event removed');await review.getByLabel('Reason for calendar decision').fill('Confirmed cancellation in the provider');await review.getByRole('button',{name:'Cancel booking to match calendar'}).click();await expect(page.getByText('Booking cancelled to match the calendar. No message was sent.',{exact:true})).toBeVisible();await expect(review).toHaveCount(0)
 expect((await fixture.db.from('tour_bookings').select('status').eq('id',fixture.booking).single()).data?.status).toBe('cancelled')
 expect((await fixture.db.from('shared_action_events').select('action,phase,training_eligible').eq('property_id',fixture.property).eq('action','tour.calendar_change.reviewed')).data).toEqual([{action:'tour.calendar_change.reviewed',phase:'succeeded',training_eligible:false}])
})

test('active bookings remain reachable beyond the first recovery page',async({page,fixture})=>{
 test.setTimeout(90000)
 const source=await fixture.db.from('tour_bookings').select('lead_id').eq('id',fixture.booking).single();if(source.error)throw source.error
 const extra=Array.from({length:101},(_,index)=>({id:randomUUID(),property_id:fixture.property,lead_id:source.data.lead_id,scheduled_date:new Date(Date.now()+(index+14)*86400000).toISOString().slice(0,10),scheduled_time:'12:00',duration_minutes:30,status:'confirmed',schedule_timezone:'America/Chicago'}))
 for(let index=0;index<extra.length;index+=10)expect((await fixture.db.from('tour_bookings').insert(extra.slice(index,index+10))).error).toBeNull()
 await open(page,fixture.property);await expect(page.getByText(/Status: confirmed/)).toHaveCount(100)
 await page.getByRole('button',{name:'Load more bookings',exact:true}).click();await expect(page.getByText(/Status: confirmed/)).toHaveCount(102);await expect(page.getByRole('button',{name:'Load more bookings',exact:true})).toHaveCount(0)
})

test('adopts a displayed duration change with before and after history',async({page,fixture},info)=>{
 fixture.remote.endDateTime=new Date(Date.parse(fixture.remote.startDateTime)+45*60000).toISOString()
 expect((await fixture.db.from('calendar_events').update({remote_snapshot:fixture.remote}).eq('id',fixture.event)).error).toBeNull()
 await page.route('**/api/lumaleasing/tours/calendar-review',async route=>route.fulfill({json:await apply(fixture,route.request().postDataJSON())}))
 await open(page,fixture.property);const review=page.getByRole('region',{name:'Review calendar change'})
 await expect(review).toContainText('30 minutes in the console → 45 minutes in the calendar');await review.getByLabel('Reason for calendar decision').fill('Approved the longer tour after reviewing the schedule')
 await review.getByRole('button',{name:'Use calendar time and duration',exact:true}).click();await expect(page.getByText('Booking updated to match the calendar. No message was sent.',{exact:true})).toBeVisible()
 expect((await fixture.db.from('tour_bookings').select('duration_minutes,schedule_version').eq('id',fixture.booking).single()).data).toEqual({duration_minutes:45,schedule_version:2})
 await page.goto('/dashboard/activity');await page.getByLabel('Product',{exact:true}).selectOption('tourspark');await expect(page.getByRole('region',{name:'Recorded activity'})).toContainText('30 minute tour');await expect(page.getByRole('region',{name:'Recorded activity'})).toContainText('45 minute tour');await page.screenshot({path:info.outputPath('calendar-duration-history.png'),fullPage:true})
})
test('restores a missing event with one queued decision and waits for an actual receipt',async({page,fixture},info)=>{
 const booking=await fixture.db.from('tour_bookings').select('lead_id').eq('id',fixture.booking).single();expect(booking.error).toBeNull()
 expect((await fixture.db.from('leads').update({email:'restore-guest@example.invalid'}).eq('id',booking.data!.lead_id)).error).toBeNull()
 expect((await fixture.db.from('calendar_events').update({sync_status:'external_missing',remote_snapshot:null}).eq('id',fixture.event)).error).toBeNull()
 let lost=true;const ids:string[]=[]
 await page.route('**/api/lumaleasing/tours/calendar-review',async route=>{const body=route.request().postDataJSON();ids.push(body.requestId);expect(body.action).toBe('restore');const result=await apply(fixture,body,null);if(lost){lost=false;expect(result.state).toBe('applied');return route.fulfill({status:503,json:{error:'Restoration saved; response lost. Retry the same decision.'}})}expect(result.state).toBe('replayed');return route.fulfill({json:result})})
 await open(page,fixture.property);const review=page.getByRole('region',{name:'Review calendar change'});await review.getByLabel('Reason for calendar decision').fill('Keep the confirmed tour and restore its missing event')
 await review.getByRole('button',{name:'Restore console schedule to calendar'}).click();await expect(review.getByRole('alert')).toContainText('response lost');await review.getByRole('button',{name:'Restore console schedule to calendar'}).click()
 await expect(page.getByText('Calendar restoration queued. The booking keeps its saved schedule; provider confirmation is pending.',{exact:true})).toBeVisible();await expect(review).toHaveCount(0);expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1])
 expect((await fixture.db.from('tour_bookings').select('scheduled_time,status,schedule_version').eq('id',fixture.booking).single()).data).toEqual({scheduled_time:'10:00:00',status:'confirmed',schedule_version:2})
 expect((await fixture.db.from('calendar_events').select('sync_status,provider_event_id').eq('id',fixture.event).single()).data).toEqual({sync_status:'pending',provider_event_id:'fixture-event'})
 const work=await fixture.db.from('tour_schedule_work').select('*').eq('tour_id',fixture.booking);expect(work.error).toBeNull();expect(work.data).toHaveLength(1);expect(work.data![0]).toMatchObject({state:'queued',receipt:null,payload:{restore:true,replacesEventId:'fixture-event'}})
 await page.screenshot({path:info.outputPath('calendar-restoration-pending.png'),fullPage:true})
 // Simulated provider acceptance is passed to the real receipt transaction; no provider request runs.
 const claim=await fixture.db.rpc('claim_tour_schedule_work',{p_id:work.data![0].id});expect(claim.error).toBeNull();expect(claim.data).toBeTruthy()
 expect((await fixture.db.rpc('start_tour_schedule_delivery',{p_id:work.data![0].id,p_token:claim.data.lease_token,p_dispatch:{}})).error).toBeNull()
 const receipt=await fixture.db.rpc('finish_tour_schedule_work',{p_id:work.data![0].id,p_token:claim.data.lease_token,p_success:true,p_receipt:{eventId:'restored-fixture'}});expect(receipt.error).toBeNull();expect(receipt.data).toBe(true)
 expect((await fixture.db.from('calendar_events').select('sync_status,provider_event_id').eq('id',fixture.event).single()).data).toEqual({sync_status:'synced',provider_event_id:'restored-fixture'})
 await page.goto('/dashboard/activity');await page.getByLabel('Product',{exact:true}).selectOption('tourspark');await expect(page.getByRole('heading',{name:'Reviewed external calendar change',exact:true})).toHaveCount(1);await expect(page.getByRole('region',{name:'Recorded activity'})).toContainText('Calendar update pending')
})
