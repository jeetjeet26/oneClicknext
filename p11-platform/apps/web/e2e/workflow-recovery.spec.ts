import {expect, test as base} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430'
const databaseURL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const local = ['localhost','127.0.0.1']
const createFixtureClient = () => createClient(databaseURL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
base.skip(!local.includes(new URL(baseURL).hostname), 'Local fixtures only')
const test=base.extend<{fixture:{property:string;lead:string;workflow:string;delivery:string;token:string;db:ReturnType<typeof createFixtureClient>}}>({
 fixture:async({},provide)=>{
  if(!databaseURL||!local.includes(new URL(databaseURL).hostname))throw new Error('Local database required')
  const db=createFixtureClient(),property=randomUUID(),lead=randomUUID(),definition=randomUUID(),workflow=randomUUID()
  async function save(q:PromiseLike<{error:unknown}>){const r=await q;if(r.error)throw r.error}
  try{
   await save(db.from('properties').insert({id:property,name:'Workflow recovery browser fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{timezone:'UTC'}}))
   await save(db.from('leads').insert({id:lead,property_id:property,first_name:'Workflow',last_name:'Fixture',email:'workflow@example.invalid',source:'manual',status:'new'}))
   await save(db.from('follow_up_templates').insert({property_id:property,slug:'fixture',name:'Fixture',channel:'email',body:'Fixture message',subject:'Fixture',is_active:true}))
   await save(db.from('workflow_definitions').insert({id:definition,property_id:property,name:'Browser follow-up fixture',trigger_on:'lead_created',steps:[{id:0,delay_hours:0,action:'email',template_slug:'fixture'}],exit_conditions:['leased','lost'],is_active:true}))
   await save(db.from('lead_workflows').insert({id:workflow,lead_id:lead,workflow_id:definition,current_step:0,status:'active',next_action_at:new Date(Date.now()-60000).toISOString()}))
   const prepared=await db.rpc('prepare_workflow_delivery',{p_workflow_id:workflow});if(prepared.error)throw prepared.error
   const delivery=prepared.data.id,token=prepared.data.lease_token
   await save(db.rpc('start_workflow_delivery',{p_id:delivery,p_token:token,p_body:'Fixture message',p_subject:'Fixture',p_sender:'fixture@example.invalid'}))
   await save(db.rpc('finish_workflow_delivery',{p_id:delivery,p_token:token,p_provider_id:null}))
   await save(db.from('workflow_deliveries').update({lease_until:new Date(Date.now()-1000).toISOString()}).eq('id',delivery))
   await provide({property,lead,workflow,delivery,token,db})
  }finally{
   await save(db.from('leads').delete().eq('id',lead))
   execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
   expect((await db.from('properties').select('id').eq('id',property)).data).toHaveLength(0)
  }
 }
})
test.beforeEach(async ({page}) => {
  await page.goto('/auth/login')
  await page.getByLabel('Email address').fill('local-admin@p11.test')
  await page.getByLabel('Password',{exact:true}).fill('local-dev-password')
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await expect(page).not.toHaveURL(/\/auth\/login/)
})
async function openWorkflow(page:import('@playwright/test').Page,property:string){
 await page.goto('/dashboard/leads');await page.locator('header select').selectOption(property)
 await page.getByText('Workflow Fixture',{exact:true}).click();await page.getByRole('button',{name:/^Automation/}).click()
}
test('operator pause and acceptance preserve receipt until resumed, across reload',async({page,fixture},info)=>{
 await openWorkflow(page,fixture.property)
 await page.getByRole('button',{name:'Pause',exact:true}).click();await expect(page.getByRole('button',{name:'Resume',exact:true})).toBeVisible()
 const form=page.getByRole('form',{name:'Review follow-up step 1'})
 await form.getByLabel('Provider message ID').fill('fixture-confirmed-email')
 await form.getByLabel('Review evidence').fill('Checked local provider fixture; email accepted.')
 await form.getByRole('button',{name:'Save follow-up review'}).click()
 await expect(page.getByText('Message ID: fixture-confirmed-email')).toBeVisible()
 await expect(page.getByRole('button',{name:'Resume',exact:true})).toBeVisible()
 expect((await fixture.db.from('lead_workflows').select('status,current_step').eq('id',fixture.workflow).single()).data).toMatchObject({status:'paused',current_step:0})
 await page.reload();await page.getByText('Workflow Fixture',{exact:true}).click();await page.getByRole('button',{name:/^Automation/}).click()
 await expect(page.getByText('Message ID: fixture-confirmed-email')).toBeVisible()
 await expect(page.getByRole('button',{name:'Resume',exact:true})).toBeVisible()
 await page.screenshot({path:info.outputPath('followup-history-desktop.png')})
 await page.getByRole('button',{name:'Resume',exact:true}).click();await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible()
 const settled=await fixture.db.rpc('prepare_workflow_delivery',{p_workflow_id:fixture.workflow});expect(settled.error).toBeNull()
 expect((await fixture.db.from('lead_workflows').select('status').eq('id',fixture.workflow).single()).data!.status).toBe('completed')
 expect((await fixture.db.from('workflow_actions').select('id').eq('lead_workflow_id',fixture.workflow)).data).toHaveLength(1)
})
test('mobile review safely replays a lost response and preserves paused state',async({page,fixture},info)=>{
 await page.setViewportSize({width:390,height:844});await openWorkflow(page,fixture.property)
 await page.getByRole('button',{name:'Pause',exact:true}).click();await expect(page.getByRole('button',{name:'Resume',exact:true})).toBeVisible()
 const form=page.getByRole('form',{name:'Review follow-up step 1'})
 await form.getByLabel('Review outcome').selectOption('not_sent');await form.getByLabel('Review evidence').fill('Local provider fixture confirms no acceptance.')
 let first=true;const ids:string[]=[]
 await page.route('**/api/workflows/recovery',async route=>{
  if(route.request().method()!=='POST'){await route.continue();return}
  ids.push(route.request().postDataJSON().requestId)
  if(first){first=false;expect((await route.fetch()).status()).toBe(200);await route.abort('failed');return}await route.continue()
 })
 await form.getByRole('button',{name:'Save follow-up review'}).click();await expect(form.getByRole('status')).toContainText('unconfirmed')
 await page.screenshot({path:info.outputPath('followup-review-mobile-retry.png')})
 await form.getByRole('button',{name:'Save follow-up review'}).click()
 await expect(page.getByRole('region',{name:'Follow-up delivery'}).getByText('Queued',{exact:true})).toBeVisible()
 expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1])
 expect((await fixture.db.from('lead_workflows').select('status').eq('id',fixture.workflow).single()).data!.status).toBe('paused')
 expect((await fixture.db.from('workflow_delivery_reviews').select('id').eq('property_id',fixture.property)).data).toHaveLength(1)
 expect((await fixture.db.rpc('finish_workflow_delivery',{p_id:fixture.delivery,p_token:fixture.token,p_provider_id:'stale-worker'})).data).toBe(false)
})
test('review API enforces actor scope and concurrent decisions have one winner',async({page,request,fixture})=>{
 const body={leadId:fixture.lead,deliveryId:fixture.delivery,requestId:randomUUID(),resolution:'accepted',reason:'Local receipt fixture',providerId:'fixture-concurrent'}
 expect((await request.post(`${baseURL}/api/workflows/recovery`,{data:body})).status()).toBe(401)
 const responses=await Promise.all([page.request.post('/api/workflows/recovery',{data:body}),page.request.post('/api/workflows/recovery',{data:{...body,requestId:randomUUID()}})])
 expect(responses.map(r=>r.status()).sort()).toEqual([200,409])
 const history=await (await page.request.get(`/api/workflows/recovery?leadId=${fixture.lead}`)).json()
 expect(history.work[0].providerId).toBe('fixture-concurrent');expect(JSON.stringify(history)).not.toContain('lease_token')
 expect((await page.request.post('/api/workflows/recovery',{data:{...body,leadId:randomUUID(),requestId:randomUUID()}})).status()).toBe(404)
})
