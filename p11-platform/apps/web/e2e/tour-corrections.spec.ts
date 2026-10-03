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
    const recentTour=new Date(Date.now()-2*60*60*1000).toISOString()
    const date=recentTour.slice(0,10), time=recentTour.slice(11,16)
    async function save(query: PromiseLike<{error: unknown}>) {const result=await query; if(result.error) throw result.error}
    try {
      await save(db.from('properties').insert({id:property,name:'Tour correction browser fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{timezone:'UTC'}}))
      await save(db.from('leads').insert({id:lead,property_id:property,first_name:'Correction',last_name:'Fixture',email:'tour-outcome@example.invalid',source:'manual',status:'tour_booked'}))
      await save(db.from('tours').insert({id:tour,property_id:property,lead_id:lead,tour_date:date,tour_time:time,status:'confirmed'}))
      await save(db.from('workflow_definitions').insert({property_id:property,name:'Local outcome follow-up',trigger_on:'tour_completed',steps:[{action:'email',template_slug:'local-only',delay_hours:8760}],exit_conditions:['leased','lost']}))
      await save(db.from('workflow_definitions').insert({property_id:property,name:'Local no-show follow-up',trigger_on:'tour_no_show',steps:[{action:'email',template_slug:'local-only',delay_hours:8760}],exit_conditions:['leased','lost']}))
      await save(db.rpc('record_tour_outcome',{p_property_id:property,p_lead_id:lead,p_source:'tours',p_tour_id:tour,p_outcome:'no_show',p_notes:'Earlier no-show record',p_automatic:false}))
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
async function openCorrection(page: import('@playwright/test').Page, property: string) {
 await page.goto('/dashboard/leads')
 await page.locator('header select').selectOption(property)
 await page.getByText('Correction Fixture',{exact:true}).click()
 await page.getByRole('button',{name:/^Tours/}).click()
 await page.getByRole('button',{name:'Correct no-show',exact:true}).click()
}
test('corrects a no-show with an audit trail and persistent history',async({page,fixture},info)=>{
 await openCorrection(page,fixture.property)
 await expect(page.getByRole('button',{name:'Save correction',exact:true})).toBeDisabled()
 await page.getByLabel('Reason for correction').fill('The agent confirmed the prospect attended.')
 await page.getByRole('button',{name:'Save correction',exact:true}).click()
 await expect(page.getByText('No-show corrected to completed. Queued no-show follow-ups were stopped.',{exact:false})).toBeVisible()
 await expect(page.getByText('Corrected from no-show',{exact:true})).toBeVisible()
 const audit=await fixture.db.from('tour_outcome_corrections').select('*').eq('tour_id',fixture.tour)
 expect(audit.error).toBeNull();expect(audit.data).toHaveLength(1)
 expect(audit.data![0].previous_outcome.notes).toBe('Earlier no-show record')
 const events=await fixture.db.from('lead_engagement_events').select('event_type,score_weight').eq('lead_id',fixture.lead)
 expect(events.data).toEqual(expect.arrayContaining([{event_type:'tour_no_show',score_weight:0},{event_type:'tour_completed',score_weight:35}]))
 const stopped=await fixture.db.from('lead_workflows').select('status').in('id',audit.data![0].stopped_workflow_ids)
 expect(stopped.data).toEqual([{status:'stopped'}])
 await page.screenshot({path:info.outputPath('tour-correction-desktop.png')})
 await page.reload();await page.getByText('Correction Fixture',{exact:true}).click();await page.getByRole('button',{name:/^Tours/}).click()
 await expect(page.getByText('Corrected from no-show',{exact:true})).toBeVisible()
 await expect(page.getByText('The agent confirmed the prospect attended.',{exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Correct no-show',exact:true})).toHaveCount(0)
})
test('mobile retry reuses a correction after its successful response is lost',async({page,fixture},info)=>{
 await page.setViewportSize({width:390,height:844})
 const ids:string[]=[];let first=true
 await page.route('**/api/tours/correct',async route=>{
   ids.push(route.request().postDataJSON().requestId)
   if(first){first=false;const result=await route.fetch();expect(result.status()).toBe(200);await route.abort('failed');return}
   await route.continue()
 })
 await openCorrection(page,fixture.property)
 await page.getByLabel('Reason for correction').fill('Attendance confirmed by the leasing team.')
 await page.getByRole('button',{name:'Save correction',exact:true}).click()
 await expect(page.getByRole('form',{name:'Correct tour no-show'}).getByRole('alert')).toContainText('unconfirmed')
 await page.screenshot({path:info.outputPath('tour-correction-mobile-retry.png')})
 await page.getByRole('button',{name:'Save correction',exact:true}).click()
 await expect(page.getByText('Corrected from no-show',{exact:true})).toBeVisible()
 expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1])
 expect((await fixture.db.from('tour_outcome_corrections').select('id').eq('tour_id',fixture.tour)).data).toHaveLength(1)
 expect((await fixture.db.from('lead_engagement_events').select('id').eq('lead_id',fixture.lead).eq('event_type','tour_completed')).data).toHaveLength(1)
})
test('real API defers active and uncertain sends, then discloses a previous receipt',async({page,fixture})=>{
 const workflow=(await fixture.db.from('lead_workflows').select('id').eq('lead_id',fixture.lead).single()).data!.id
 const body={tourId:fixture.tour,requestId:randomUUID(),reason:'Attendance verified'}
 expect((await fixture.db.from('lead_workflows').update({status:'stopped',processing_started_at:new Date().toISOString(),processing_expires_at:new Date(Date.now()+60000).toISOString()}).eq('id',workflow)).error).toBeNull()
 const busy=await page.request.post('/api/tours/correct',{data:body});expect(busy.status()).toBe(409);expect((await busy.json()).code).toBe('delivery_busy')
 expect((await fixture.db.from('lead_workflows').update({processing_expires_at:new Date(Date.now()-60000).toISOString()}).eq('id',workflow)).error).toBeNull()
 const uncertain=await page.request.post('/api/tours/correct',{data:body});expect(uncertain.status()).toBe(409);expect((await uncertain.json()).code).toBe('delivery_review_required')
 expect((await fixture.db.from('tour_outcome_corrections').select('id').eq('tour_id',fixture.tour)).data).toHaveLength(0)
 expect((await fixture.db.from('lead_workflows').update({processing_started_at:null,processing_expires_at:null,status:'paused'}).eq('id',workflow)).error).toBeNull()
 expect((await fixture.db.from('workflow_actions').insert({lead_workflow_id:workflow,step_number:0,action_type:'email',status:'sent',external_id:'local-fixture-receipt'})).error).toBeNull()
 const saved=await page.request.post('/api/tours/correct',{data:body});expect(saved.status()).toBe(200);expect((await saved.json()).correction.previousDelivery).toBe('sent')
 await page.goto('/dashboard/leads');await page.locator('header select').selectOption(fixture.property)
 await page.getByText('Correction Fixture',{exact:true}).click();await page.getByRole('button',{name:/^Tours/}).click()
 await expect(page.getByText('A no-show message was previously sent. It cannot be recalled.',{exact:true})).toBeVisible()
})
test('real API enforces scope and concurrent correction uniqueness',async({page,request,fixture})=>{
 const body={tourId:fixture.tour,requestId:randomUUID(),reason:'Confirmed with agent'}
 expect((await request.post('/api/tours/correct',{data:body})).status()).toBe(401)
 const foreignProperty=randomUUID(), foreignLead=randomUUID(), foreignTour=randomUUID()
 try {
   expect((await fixture.db.from('properties').insert({id:foreignProperty,name:'Tour correction scope fixture',org_id:null})).error).toBeNull()
   expect((await fixture.db.from('leads').insert({id:foreignLead,property_id:foreignProperty,first_name:'Scope',last_name:'Fixture',source:'manual'})).error).toBeNull()
   expect((await fixture.db.from('tours').insert({id:foreignTour,property_id:foreignProperty,lead_id:foreignLead,tour_date:fixture.date,tour_time:'10:00',status:'no_show'})).error).toBeNull()
   expect((await page.request.post('/api/tours/correct',{data:{...body,tourId:foreignTour}})).status()).toBe(403)
   expect((await fixture.db.from('tour_outcome_corrections').select('id').eq('tour_id',foreignTour)).data).toHaveLength(0)
 } finally {
   expect((await fixture.db.from('leads').delete().eq('id',foreignLead)).error).toBeNull()
   expect((await fixture.db.from('properties').delete().eq('id',foreignProperty)).error).toBeNull()
 }
 const results=await Promise.all([page.request.post('/api/tours/correct',{data:body}),page.request.post('/api/tours/correct',{data:{...body,requestId:randomUUID()}})])
 expect(results.map(x=>x.status()).sort()).toEqual([200,409])
 expect((await fixture.db.from('tour_outcome_corrections').select('id').eq('tour_id',fixture.tour)).data).toHaveLength(1)
 expect((await fixture.db.from('lead_engagement_events').select('id').eq('lead_id',fixture.lead).eq('event_type','tour_completed')).data).toHaveLength(1)
})
