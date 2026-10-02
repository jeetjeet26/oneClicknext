import {expect,test as base} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const baseURL=process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:9430'
const databaseURL=process.env.NEXT_PUBLIC_SUPABASE_URL||''
const local=['localhost','127.0.0.1']
const createFixtureClient=()=>createClient(databaseURL,process.env.SUPABASE_SERVICE_ROLE_KEY!)
base.skip(!local.includes(new URL(baseURL).hostname),'Local fixture only')
const test=base.extend<{fixture:{property:string;db:ReturnType<typeof createFixtureClient>}}>({
 fixture:async({},provideFixture)=>{
  if(!databaseURL||!local.includes(new URL(databaseURL).hostname))throw new Error('Local database required')
  const db=createFixtureClient(),property=randomUUID()
  const save=async(query:PromiseLike<{error:unknown}>)=>{const result=await query;if(result.error)throw result.error}
  try{
   const profile=await db.from('profiles').select('id').eq('org_id','22222222-2222-2222-2222-222222222222').limit(1).single();if(profile.error)throw profile.error
   await save(db.from('properties').insert({id:property,name:'Configuration save browser fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{}}))
   await save(db.from('agent_calendars').insert({profile_id:profile.data.id,property_id:property,provider:'google',google_email:'calendar@example.invalid',account_email:'calendar@example.invalid',access_token:'local-fixture-only',refresh_token:'local-fixture-only',token_expires_at:'2099-01-01T00:00:00Z',token_status:'healthy',timezone:null,sync_enabled:true}))
   await provideFixture({property,db})
  }finally{
   execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
   expect((await db.from('properties').select('id').eq('id',property)).data).toHaveLength(0)
  }
 }
})
test.beforeEach(async({page})=>{
 await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/)
})

async function open(page:import('@playwright/test').Page,property:string){
 await page.goto('/dashboard/lumaleasing');await page.locator('header select').selectOption(property);await page.getByRole('button',{name:'Configuration',exact:true}).click()
}
test('failed read stays unavailable and initialization recovers one saved action',async({page,fixture},info)=>{
 let failRead=true,lost=true;const ids:string[]=[]
 await page.route('**/api/lumaleasing/admin/config*',async route=>{
  if(route.request().method()==='GET'&&failRead)return route.fulfill({status:503,json:{error:'Fixture unavailable'}})
  if(route.request().method()==='POST'){
   ids.push(route.request().postDataJSON().requestId)
   if(lost){lost=false;const saved=await route.fetch();expect(saved.status()).toBe(200);return route.fulfill({status:503,json:{error:'Initialization response was lost. Retry the same request.'}})}
  }
  return route.continue()
 })
 await open(page,fixture.property)
 await expect(page.getByRole('button',{name:'Retry configuration'})).toBeVisible();await expect(page.getByRole('button',{name:'Initialize LumaLeasing',exact:true})).toBeHidden()
 expect((await fixture.db.from('lumaleasing_config').select('id').eq('property_id',fixture.property)).data).toHaveLength(0)
 failRead=false;await page.getByRole('button',{name:'Retry configuration'}).click();await page.getByRole('button',{name:'Initialize LumaLeasing',exact:true}).click()
 await expect(page.getByText('Initialization response was lost. Retry the same request.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Initialize LumaLeasing',exact:true}).click()
 await expect(page.getByText('Save recovered. Current saved settings are shown.',{exact:true})).toBeVisible();expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1])
 const events=await fixture.db.from('shared_action_events').select('id,training_eligible').eq('property_id',fixture.property).eq('action','luma.configuration.created');expect(events.data).toEqual([{id:ids[0],training_eligible:false}])
 await page.screenshot({path:info.outputPath('configuration-initialized.png'),fullPage:true})
})
test('settings and calendar commit together and a lost response does not duplicate the decision',async({page,fixture},info)=>{
 await open(page,fixture.property);await page.getByRole('button',{name:'Initialize LumaLeasing',exact:true}).click();await expect(page.getByLabel('Widget name')).toBeVisible()
 await page.getByLabel('Widget name').fill('Saved fixture assistant');await expect(page.getByText('Unsaved changes',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Behavior',exact:true}).click();await page.getByLabel('Scheduling timezone').selectOption('America/New_York')
 let lost=true;const ids:string[]=[]
 await page.route('**/api/lumaleasing/admin/config',async route=>{
  if(route.request().method()!=='PUT')return route.continue()
  ids.push(route.request().postDataJSON().requestId)
  if(lost){lost=false;const saved=await route.fetch();expect(saved.status()).toBe(200);return route.fulfill({status:503,json:{error:'Save response was lost. Retry the same change.'}})}
  return route.continue()
 })
 await page.getByRole('button',{name:'Save Changes',exact:true}).click();await expect(page.getByText('Save response was lost. Retry the same change.',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Save Changes',exact:true}).click();await expect(page.getByText('Save recovered. Current saved settings are shown.',{exact:true})).toBeVisible()
 expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1])
 expect((await fixture.db.from('properties').select('settings').eq('id',fixture.property).single()).data?.settings.timezone).toBe('America/New_York')
 expect((await fixture.db.from('agent_calendars').select('timezone').eq('property_id',fixture.property).single()).data?.timezone).toBe('America/New_York')
 expect((await fixture.db.from('shared_action_events').select('id').eq('property_id',fixture.property).eq('action','luma.configuration.saved')).data).toEqual([{id:ids[0]}])
 await page.reload();await page.getByRole('button',{name:'Configuration',exact:true}).click();await expect(page.getByLabel('Widget name')).toHaveValue('Saved fixture assistant')
 await page.screenshot({path:info.outputPath('configuration-recovered.png'),fullPage:true})
 await page.goto('/dashboard/activity');await page.getByLabel('Product',{exact:true}).selectOption('lumaleasing')
 await expect(page.getByRole('heading',{name:'Saved leasing assistant settings',exact:true})).toHaveCount(1)
 await expect(page.getByRole('heading',{name:'Initialized leasing assistant',exact:true})).toHaveCount(1)
 await expect(page.getByRole('region',{name:'Recorded activity'})).toContainText('Saved fixture assistant')
 await page.screenshot({path:info.outputPath('configuration-action-history.png'),fullPage:true})

})
test('stale settings preserve the draft until the operator reloads current values',async({page,fixture})=>{
 await open(page,fixture.property);await page.getByRole('button',{name:'Initialize LumaLeasing',exact:true}).click();await page.getByLabel('Widget name').fill('My stale draft')
 expect((await fixture.db.from('lumaleasing_config').update({widget_name:'Newer saved name'}).eq('property_id',fixture.property)).error).toBeNull()
 await page.getByRole('button',{name:'Save Changes',exact:true}).click();await expect(page.getByRole('button',{name:'Load latest settings'})).toBeVisible();await expect(page.getByLabel('Widget name')).toHaveValue('My stale draft');await expect(page.getByRole('button',{name:'Save Changes',exact:true})).toBeDisabled()
 expect((await fixture.db.from('lumaleasing_config').select('widget_name').eq('property_id',fixture.property).single()).data?.widget_name).toBe('Newer saved name')
 await page.getByRole('button',{name:'Load latest settings'}).click();await expect(page.getByLabel('Widget name')).toHaveValue('Newer saved name');await expect(page.getByRole('button',{name:'Save Changes',exact:true})).toBeEnabled()
})
