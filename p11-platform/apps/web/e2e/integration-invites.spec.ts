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
  await save(db.from('properties').insert({id:property,name:'Invitation browser fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{timezone:'UTC'}}))
  await save(db.from('lumaleasing_config').insert({property_id:property,api_key:`local-fixture-${property}`,timezone:'UTC'}))
  await provide({property,actor:profile.data.id,db})
 }finally{
  execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
  expect((await db.from('properties').select('id').eq('id',property)).data).toHaveLength(0)
 }
}})
test.beforeEach(async({page})=>{await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/)})
async function open(page:import('@playwright/test').Page,property:string){await page.goto('/dashboard/lumaleasing');await page.locator('header select').selectOption(property);await page.getByRole('button',{name:'Configuration',exact:true}).click();await page.getByRole('button',{name:'Lead Capture',exact:true}).click()}

test('recovers link creation and revocation after lost responses, with one action each',async({page,fixture},info)=>{
 let loseCreate=true,loseRevoke=true;const creations:string[]=[],revocations:string[]=[]
 await page.route('**/api/lumaleasing/integration-invites',async route=>{
  if(route.request().method()!=='POST')return route.continue()
  creations.push(route.request().postDataJSON().requestId)
  if(loseCreate){loseCreate=false;expect((await route.fetch()).status()).toBe(201);return route.fulfill({status:503,json:{error:'Creation response lost. Retry the same request.'}})}
  return route.continue()
 })
 await page.route('**/api/lumaleasing/integration-invites/*',async route=>{
  if(route.request().method()!=='DELETE')return route.continue()
  revocations.push(route.request().postDataJSON().requestId)
  if(loseRevoke){loseRevoke=false;expect((await route.fetch()).status()).toBe(200);return route.fulfill({status:503,json:{error:'Revocation response lost. Retry the same request.'}})}
  return route.continue()
 })
 await open(page,fixture.property);const panel=page.getByRole('region',{name:'Client authorization links'})
 await panel.getByRole('button',{name:'Create client link',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('Creation response lost')
 await panel.getByRole('button',{name:'Retry link creation',exact:true}).click();await expect(panel.getByRole('textbox',{name:'Authorization link',exact:true})).toBeVisible()
 const url=await panel.getByRole('textbox',{name:'Authorization link',exact:true}).inputValue();expect(creations).toHaveLength(2);expect(creations[0]).toBe(creations[1]);expect((await fixture.db.from('integration_auth_invites').select('id').eq('property_id',fixture.property)).data).toHaveLength(1)
 await page.reload();await page.getByRole('button',{name:'Configuration',exact:true}).click();await page.getByRole('button',{name:'Lead Capture',exact:true}).click();await panel.getByRole('button',{name:'Recover link',exact:true}).click();await expect(panel.getByRole('textbox',{name:'Authorization link',exact:true})).toHaveValue(url)
 await panel.getByRole('button',{name:'Revoke link',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('Revocation response lost');await panel.getByRole('button',{name:'Retry revocation',exact:true}).click();await expect(panel.getByText('Authorization link revoked and recorded.',{exact:true})).toBeVisible();expect(revocations).toHaveLength(2);expect(revocations[0]).toBe(revocations[1]);await expect(panel.getByRole('textbox',{name:'Authorization link',exact:true})).toHaveCount(0)
 const history=await fixture.db.from('shared_action_events').select('action,training_eligible,request,after_state').eq('property_id',fixture.property).in('action',['integration.invite.created','integration.invite.revoked']);expect(history.data).toHaveLength(2);expect(history.data?.every(row=>row.training_eligible===false)).toBe(true);expect(JSON.stringify(history.data)).not.toContain(new URL(url).searchParams.get('token'))
 await page.screenshot({path:info.outputPath('invitation-recovery-revoked.png'),fullPage:true})
 await page.goto('/dashboard/activity');await page.getByLabel('Product',{exact:true}).selectOption('integrations');await expect(page.getByRole('heading',{name:'Created authorization link',exact:true})).toHaveCount(1);await expect(page.getByRole('heading',{name:'Revoked authorization link',exact:true})).toHaveCount(1);await page.screenshot({path:info.outputPath('invitation-action-history.png'),fullPage:true})
})
test('a used invitation has no revoke control and keeps its connected account',async({page,fixture})=>{
 await open(page,fixture.property);const panel=page.getByRole('region',{name:'Client authorization links'});await panel.getByRole('combobox',{name:'Link access'}).selectOption('calendar');await panel.getByRole('button',{name:'Create client link',exact:true}).click();await expect(panel.getByRole('textbox',{name:'Authorization link',exact:true})).toBeVisible()
 const row=await fixture.db.from('integration_auth_invites').select('*').eq('property_id',fixture.property).single();expect(row.error).toBeNull()
 const request=randomUUID(),context={propertyId:fixture.property,profileId:null,provider:'google',capabilities:['calendar'],authSource:'external_invite',inviteId:row.data.id,tokenHash:row.data.token_hash,redirectUri:'http://127.0.0.1:9430/fixture',requestedScopes:['https://www.googleapis.com/auth/calendar']},args={p_id:request,p_context:context}
 expect((await fixture.db.rpc('begin_integration_authorization',args)).data.state).toBe('ready');expect((await fixture.db.rpc('claim_integration_authorization',args)).data.state).toBe('claimed');expect((await fixture.db.rpc('finish_integration_authorization',{...args,p_grant:{accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:new Date(Date.now()+3600000).toISOString(),accountEmail:'fixture@example.invalid',subject:'fixture-subject',timezone:'UTC',scopes:['https://www.googleapis.com/auth/calendar'],scopeEvidence:'provider_response'}})).data.state).toBe('saved')
 await page.reload();await page.getByRole('button',{name:'Configuration',exact:true}).click();await page.getByRole('button',{name:'Lead Capture',exact:true}).click();await expect(panel.getByText('Used',{exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'Revoke link',exact:true})).toHaveCount(0);await expect(panel.getByRole('button',{name:'Recover link',exact:true})).toHaveCount(0)
 expect((await fixture.db.from('agent_calendars').select('sync_enabled').eq('property_id',fixture.property).single()).data?.sync_enabled).toBe(true)
})
test('link history errors recover and older links remain reachable',async({page,fixture})=>{
 const rows=Array.from({length:27},(_,index)=>({property_id:fixture.property,provider:'google',requested_capabilities:['email'],created_by_profile_id:fixture.actor,token_hash:`local-fixture-${fixture.property}-${index}`,expires_at:new Date(Date.now()+3600000).toISOString(),created_at:'2026-09-16T00:00:00.000Z'}));expect((await fixture.db.from('integration_auth_invites').insert(rows)).error).toBeNull()
 let down=true;await page.route('**/api/lumaleasing/integration-invites?*',async route=>down?route.fulfill({status:503,json:{error:'Unavailable'}}):route.continue())
 await open(page,fixture.property);const panel=page.getByRole('region',{name:'Client authorization links'});await expect(panel.getByRole('alert')).toContainText('Authorization links are unavailable');await expect(panel.getByRole('button',{name:'Create client link',exact:true})).toBeDisabled();down=false;await panel.getByRole('button',{name:'Retry authorization links'}).click();await expect(panel.getByRole('listitem')).toHaveCount(25);await panel.getByRole('button',{name:'Load older links'}).click();await expect(panel.getByRole('listitem')).toHaveCount(27);await expect(panel.getByRole('button',{name:'Load older links'})).toHaveCount(0)
})

test('main integrations panel creates a scoped public link that reports revocation',async({page,fixture},info)=>{
 await page.goto('/dashboard/lumaleasing');await page.locator('header select').selectOption(fixture.property);await page.getByRole('button',{name:'Integrations',exact:true}).click();const panel=page.getByRole('region',{name:'Client authorization links'});await panel.getByRole('combobox',{name:'Link provider'}).selectOption('microsoft');await panel.getByRole('combobox',{name:'Link access'}).selectOption('both');await panel.getByRole('button',{name:'Create client link',exact:true}).click();await expect(panel.getByRole('textbox',{name:'Authorization link',exact:true})).toBeVisible()
 const token=new URL(await panel.getByRole('textbox',{name:'Authorization link',exact:true}).inputValue()).searchParams.get('token')!,path=`/lumaleasing/integrations/connect?token=${encodeURIComponent(token)}`
 await page.goto(path);await expect(page.getByText('Microsoft calendar and email access for',{exact:false})).toBeVisible();await expect(page.getByRole('link',{name:'Continue with Microsoft',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Continue with Google',exact:true})).toHaveCount(0);await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content','no-referrer');await page.screenshot({path:info.outputPath('invitation-public-scope.png'),fullPage:true})
 const row=await fixture.db.from('integration_auth_invites').select('id').eq('property_id',fixture.property).single();if(row.error||!row.data)throw new Error('Fixture invite missing');expect((await page.request.delete(`/api/lumaleasing/integration-invites/${row.data.id}`,{data:{propertyId:fixture.property,requestId:randomUUID()}})).status()).toBe(200)
 await page.reload();await expect(page.getByText('Your P11 contact revoked this link.',{exact:false})).toBeVisible();await expect(page.getByRole('link',{name:'Continue with Microsoft',exact:true})).toHaveCount(0)
})
