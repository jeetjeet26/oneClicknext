import {expect,test as base} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const baseURL=process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:9430',databaseURL=process.env.NEXT_PUBLIC_SUPABASE_URL||''
const local=['localhost','127.0.0.1'],client=()=>createClient(databaseURL,process.env.SUPABASE_SERVICE_ROLE_KEY!)
base.skip(!local.includes(new URL(baseURL).hostname),'Local fixtures only')
const test=base.extend<{fixture:{property:string;actor:string;db:ReturnType<typeof client>}}>({fixture:async({},provide)=>{
 if(!databaseURL||!local.includes(new URL(databaseURL).hostname))throw new Error('Local database required')
 const db=client(),property=randomUUID()
 const save=async(q:PromiseLike<{error:unknown}>)=>{const r=await q;if(r.error)throw r.error}
 try{
  const profile=await db.from('profiles').select('id').eq('org_id','22222222-2222-2222-2222-222222222222').limit(1).single();if(profile.error)throw profile.error
  await save(db.from('properties').insert({id:property,name:'Replacement browser fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{timezone:'UTC'}}))
  await save(db.from('lumaleasing_config').insert({property_id:property,api_key:`local-fixture-${property}`,timezone:'UTC'}))
  await provide({property,actor:profile.data.id,db})
 }finally{
  execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
  expect((await db.from('properties').select('id').eq('id',property)).data).toHaveLength(0)
 }
}})
test.beforeEach(async({page})=>{await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/)})
async function open(page:import('@playwright/test').Page,property:string){await page.goto('/dashboard/lumaleasing');await page.locator('header select').selectOption(property);await page.getByRole('button',{name:'Integrations',exact:true}).click()}
async function mailbox(fixture:{property:string;actor:string;db:ReturnType<typeof client>},status='resolved'){
 const id=randomUUID(),thread=randomUUID()
 expect((await fixture.db.from('email_configurations').insert({id,property_id:fixture.property,profile_id:fixture.actor,provider:'google',provider_subject:'old-subject',google_email:'original@example.invalid',account_email:'original@example.invalid',access_token:'fixture-access',refresh_token:'fixture-refresh',token_expires_at:new Date(Date.now()+3600000).toISOString(),sync_enabled:true,token_status:'healthy'})).error).toBeNull()
 expect((await fixture.db.from('lumaleasing_config').update({email_enabled:true,email_configuration_id:id}).eq('property_id',fixture.property)).error).toBeNull()
 expect((await fixture.db.from('email_threads').insert({id:thread,email_configuration_id:id,property_id:fixture.property,gmail_thread_id:'original-thread',provider_thread_id:'original-thread',status})).error).toBeNull()
 return {id,thread}
}
async function choose(panel:import('@playwright/test').Locator){await panel.getByRole('combobox',{name:'Replacement provider'}).selectOption('microsoft');await panel.getByRole('textbox',{name:'Replacement account email'}).fill('replacement@example.invalid');await panel.getByRole('checkbox').check()}

test('reviewed replacement recovers a lost decision response, keeps history and switches current status',async({page,fixture},info)=>{
 const old=await mailbox(fixture),ids:string[]=[];let lose=true
 await page.route('**/api/lumaleasing/integration-replacement',async route=>{
  if(route.request().method()!=='POST')return route.continue()
  ids.push(route.request().postDataJSON().requestId)
  if(lose){lose=false;expect((await route.fetch()).status()).toBe(200);return route.fulfill({status:503,json:{error:'Decision response lost. Retry the same request.'}})}return route.continue()
 })
 await open(page,fixture.property);const panel=page.getByRole('region',{name:'Replace connected account'})
 await panel.getByRole('button',{name:'Review account replacement',exact:true}).click();await expect(panel.getByText('1 linked email conversation',{exact:false})).toBeVisible();await expect(panel.getByText('original@example.invalid',{exact:false})).toBeVisible();await choose(panel)
 await panel.getByRole('button',{name:'Record replacement decision',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('response lost');await panel.getByRole('button',{name:'Retry replacement decision',exact:true}).click();await expect(panel.getByRole('link',{name:'Authorize replacement account',exact:true})).toBeVisible();expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);expect((await fixture.db.from('integration_replacements').select('id').eq('property_id',fixture.property)).data).toHaveLength(1)
 const href=await panel.getByRole('link',{name:'Authorize replacement account'}).getAttribute('href');expect(href).toContain(`replacementId=${ids[0]}`)
 await panel.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('account-replacement-review.png'),fullPage:true})
 // Simulated provider evidence enters the real local transaction; no provider is contacted.
 const authId=randomUUID(),ctx={propertyId:fixture.property,profileId:fixture.actor,provider:'microsoft',capabilities:['email'],authSource:'dashboard',inviteId:null,tokenHash:null,redirectUri:'http://127.0.0.1:9430/fixture',requestedScopes:['User.Read','Mail.Send','Mail.ReadWrite'],replacementId:ids[0]},args={p_id:authId,p_context:ctx}
 expect((await fixture.db.rpc('begin_integration_authorization',args)).data.state).toBe('ready');expect((await fixture.db.rpc('claim_integration_authorization',args)).data.state).toBe('claimed')
 const saved=await fixture.db.rpc('finish_integration_authorization',{...args,p_grant:{accessToken:'replacement-access',refreshToken:'replacement-refresh',expiresAt:new Date(Date.now()+3600000).toISOString(),accountEmail:'replacement@example.invalid',subject:'new-subject',timezone:null,scopes:['User.Read','Mail.Send','Mail.ReadWrite'],scopeEvidence:'provider_response'}});expect(saved.error).toBeNull();expect(saved.data.state).toBe('saved')
 expect((await fixture.db.from('email_threads').select('email_configuration_id').eq('id',old.thread).single()).data?.email_configuration_id).toBe(old.id)
 expect((await fixture.db.from('email_configurations').select('retired_at,sync_enabled,refresh_token').eq('id',old.id).single()).data).toMatchObject({sync_enabled:false,refresh_token:null})
 const response=await page.request.get(`/api/lumaleasing/email/status?propertyId=${fixture.property}`);expect(response.status()).toBe(200);expect(await response.json()).toMatchObject({provider:'microsoft',account_email:'replacement@example.invalid',state:'connected'})
 const reply=await page.request.post('/api/lumaleasing/email/send',{data:{propertyId:fixture.property,to:'lead@example.invalid',subject:'Old thread followup',bodyText:'fixture',threadId:'original-thread'}});expect(reply.status()).toBe(400);expect((await reply.json()).error).toContain('retired email account')
 await page.reload();await page.getByRole('button',{name:'Integrations',exact:true}).click();await expect(page.getByText('replacement@example.invalid',{exact:true}).first()).toBeVisible()
 await page.goto('/dashboard/activity');await page.getByLabel('Product',{exact:true}).selectOption('integrations');await expect(page.getByRole('heading',{name:'Requested account replacement',exact:true})).toHaveCount(1);await expect(page.getByRole('heading',{name:'Replaced connected account',exact:true})).toHaveCount(1)
 const actions=await fixture.db.from('shared_action_events').select('action,training_eligible,request,before_state,after_state').eq('property_id',fixture.property).eq('product','integrations');expect(actions.data).toHaveLength(3);expect(actions.data?.every(row=>!row.training_eligible)).toBe(true);expect(JSON.stringify(actions.data)).not.toContain('replacement-refresh');await page.screenshot({path:info.outputPath('account-replacement-history.png'),fullPage:true})
})
test('unresolved work blocks replacement and a stale review cannot switch accounts',async({page,fixture})=>{
 const old=await mailbox(fixture,'awaiting_internal_reply');await open(page,fixture.property);const panel=page.getByRole('region',{name:'Replace connected account'});await panel.getByRole('button',{name:'Review account replacement',exact:true}).click();await expect(panel.getByText('Finish linked work before continuing',{exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'Record replacement decision',exact:true})).toHaveCount(0)
 expect((await fixture.db.from('email_threads').update({status:'resolved'}).eq('id',old.thread)).error).toBeNull();await panel.getByRole('button',{name:'Reload replacement review',exact:true}).click();await choose(panel)
 expect((await fixture.db.from('email_threads').update({status:'awaiting_internal_reply'}).eq('id',old.thread)).error).toBeNull();await panel.getByRole('button',{name:'Record replacement decision',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('changed');await expect(panel.getByRole('link',{name:'Authorize replacement account',exact:true})).toHaveCount(0);expect((await fixture.db.from('integration_replacements').select('id').eq('property_id',fixture.property)).data).toHaveLength(0);expect((await fixture.db.from('shared_action_events').select('phase').eq('property_id',fixture.property).eq('action','integration.replacement.requested').single()).data?.phase).toBe('failed')
})
test('review outages are recoverable and calendar changes are isolated from email',async({page,fixture},info)=>{
 await mailbox(fixture);expect((await fixture.db.from('agent_calendars').insert({property_id:fixture.property,profile_id:fixture.actor,google_email:'calendar@example.invalid',account_email:'calendar@example.invalid',provider_subject:'calendar-subject',timezone:'UTC',token_status:'healthy',sync_enabled:true,access_token:'fixture-cal-access',refresh_token:'fixture-cal-refresh',token_expires_at:new Date(Date.now()+3600000).toISOString()})).error).toBeNull()
 let down=true;await page.route('**/api/lumaleasing/integration-replacement?*',async route=>down?route.fulfill({status:503,json:{error:'Replacement review is unavailable. Retry.'}}):route.continue())
 await open(page,fixture.property);const panel=page.getByRole('region',{name:'Replace connected account'});await panel.getByRole('button',{name:'Review account replacement',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('unavailable');await expect(panel.getByRole('checkbox')).toHaveCount(0)
 down=false;await panel.getByRole('combobox',{name:'Replacement account type'}).selectOption('calendar');await panel.getByRole('button',{name:'Review account replacement',exact:true}).click();await expect(panel.getByText('calendar@example.invalid',{exact:false})).toBeVisible();await expect(panel.getByText('original@example.invalid',{exact:false})).toHaveCount(0);await expect(panel.getByText('0 linked calendar records',{exact:false})).toBeVisible();await panel.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('calendar-replacement-review.png'),fullPage:true})
})
