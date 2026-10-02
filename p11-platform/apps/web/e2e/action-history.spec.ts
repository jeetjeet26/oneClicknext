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
test('a lost control response records one action and replays without another mutation',async({page,fixture},info)=>{
 await openWorkflow(page,fixture.property)
 let first=true;const ids:string[]=[]
 await page.route(`**/api/leads/${fixture.lead}/workflow`,async route=>{
  if(route.request().method()!=='PATCH'){await route.continue();return}
  ids.push(route.request().postDataJSON().requestId)
  if(first){first=false;expect((await route.fetch()).status()).toBe(200);await route.abort('failed');return}await route.continue()
 })
 await page.getByRole('button',{name:'Pause',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'The change is unconfirmed'})).toBeVisible()
 await page.getByRole('button',{name:'Pause',exact:true}).click();await expect(page.getByRole('button',{name:'Resume',exact:true})).toBeVisible()
 expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1])
 const saved=await fixture.db.from('shared_action_events').select('*').eq('property_id',fixture.property).eq('action','workflow.pause')
 expect(saved.data).toHaveLength(1);expect(saved.data![0]).toMatchObject({evidence:'server_confirmed',phase:'succeeded',before_state:{status:'active'},after_state:{status:'paused'},training_eligible:false})
 await page.goto('/dashboard/activity');await expect(page.getByRole('heading',{name:'Paused follow-up',exact:true})).toBeVisible()
 await expect(page.getByText('active · step 1 → paused · step 1')).toBeVisible()
 await page.screenshot({path:info.outputPath('activity-history-desktop.png')})
 await page.reload();await expect(page.getByRole('heading',{name:'Paused follow-up',exact:true})).toBeVisible()
})
test('page observations retry with one identity and cannot assert business success',async({page,fixture},info)=>{
 let fail=true;const ids:string[]=[]
 await page.route('**/api/activity',async route=>{
  if(route.request().method()!=='POST'||route.request().postDataJSON().propertyId!==fixture.property){await route.continue();return}
  ids.push(route.request().postDataJSON().id)
  if(fail){expect((await route.fetch()).status()).toBe(200);await route.abort('failed');return}await route.continue()
 })
 await page.goto('/dashboard/activity');await page.locator('header select').selectOption(fixture.property)
 await expect.poll(()=>ids.length,{timeout:15000}).toBe(3)
 await expect(page.getByRole('button',{name:'Retry recording'})).toBeVisible()
 fail=false;await page.getByRole('button',{name:'Retry recording'}).click();await expect(page.getByRole('button',{name:'Retry recording'})).toBeHidden()
 expect(ids).toHaveLength(4);expect(new Set(ids).size).toBe(1)
 const rows=await fixture.db.from('shared_action_events').select('id,evidence,phase,request').eq('property_id',fixture.property).eq('action','console.page.viewed')
 expect(rows.data).toHaveLength(1);expect(rows.data![0]).toMatchObject({evidence:'browser_observed',phase:'observed',request:{path:'/dashboard/activity'}})
 await page.getByLabel('Show',{exact:true}).selectOption('browser_observed');await expect(page.getByRole('heading',{name:'Opened page',exact:true})).toBeVisible()
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('activity-observation-mobile.png')})
 const {data:{user}}=await fixture.db.auth.admin.getUserById((await fixture.db.from('shared_action_events').select('actor_id').eq('id',ids[0]).single()).data!.actor_id)
 expect((await page.request.post('/api/activity',{data:{id:randomUUID(),episodeId:randomUUID(),propertyId:fixture.property,expectedActorId:user!.id,path:'/dashboard/activity',phase:'succeeded'}})).status()).toBe(400)
 expect((await page.request.get(`/api/activity?propertyId=${randomUUID()}`)).status()).toBe(403)
})
test('history failure is visible and a refresh recovers the saved action',async({page,fixture})=>{
 const control=await page.request.patch(`/api/leads/${fixture.lead}/workflow`,{data:{workflowId:fixture.workflow,requestId:randomUUID(),action:'pause'}});expect(control.status()).toBe(200)
 let failed=true
 await page.route('**/api/activity?*',async route=>{
  if(failed&&route.request().url().includes(fixture.property)){await route.fulfill({status:500,json:{error:'Local history failure fixture'}});return}await route.continue()
 })
 await page.goto('/dashboard/activity');await page.locator('header select').selectOption(fixture.property)
 await expect(page.getByRole('alert').filter({hasText:'Local history failure fixture'})).toBeVisible()
 await expect(page.getByText('No recorded activity matches these filters.')).toBeHidden()
 failed=false;await page.getByRole('button',{name:'Refresh history'}).click();await expect(page.getByRole('heading',{name:'Paused follow-up',exact:true})).toBeVisible()
})
