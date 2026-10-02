import {expect,test as base} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID,createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const baseURL=process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:9430',databaseURL=process.env.NEXT_PUBLIC_SUPABASE_URL||''
const local=['localhost','127.0.0.1'],client=()=>createClient(databaseURL,process.env.SUPABASE_SERVICE_ROLE_KEY!)
base.skip(process.env.P11_AUTHORIZATION_BROWSER_TEST!=='1','Requires an isolated preview with a synthetic signing key and provider client ID')
base.skip(!local.includes(new URL(baseURL).hostname),'Local fixtures only')
const test=base.extend<{fixture:{property:string;actor:string;db:ReturnType<typeof client>}}>({fixture:async({},provide)=>{
 if(!databaseURL||!local.includes(new URL(databaseURL).hostname))throw new Error('Local database required')
 const db=client(),property=randomUUID()
 const save=async(q:PromiseLike<{error:unknown}>)=>{const r=await q;if(r.error)throw r.error}
 try{
  const profile=await db.from('profiles').select('id').eq('org_id','22222222-2222-2222-2222-222222222222').limit(1).single();if(profile.error)throw profile.error
  await save(db.from('properties').insert({id:property,name:'Authorization outcomes browser fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{timezone:'UTC'}}))
  await save(db.from('lumaleasing_config').insert({property_id:property,api_key:`local-fixture-${property}`,timezone:'UTC'}))
  await provide({property,actor:profile.data.id,db})
 }finally{
  execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
  expect((await db.from('properties').select('id').eq('id',property)).data).toHaveLength(0)
 }
}})
test.beforeEach(async({page})=>{await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/)})

async function start(page:import('@playwright/test').Page,property:string,token?:string){
 const query=new URLSearchParams(token?{token}:{propertyId:property,capabilities:'calendar'})
 const response=await page.request.get('/api/lumaleasing/integrations/oauth/google/start?'+query,{maxRedirects:0})
 expect(response.status()).toBe(307)
 const providerURL=new URL(response.headers().location);expect(providerURL.hostname).toBe('accounts.google.com')
 const state=providerURL.searchParams.get('state')!,payload=JSON.parse(Buffer.from(state.split('.')[0],'base64url').toString())
 expect(payload.requestId).toBeTruthy();return {state,id:payload.requestId as string}
}
async function activity(page:import('@playwright/test').Page,property:string){
 await page.goto('/dashboard/activity');await page.locator('header select').selectOption(property);await page.getByLabel('Product',{exact:true}).selectOption('integrations')
 await expect(page.getByRole('heading',{name:'Started connection request',exact:true})).toHaveCount(1)
}
test('real start and cancelled callback preserve the account and show one recoverable outcome',async({page,fixture},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
 const calendar=randomUUID();expect((await fixture.db.from('agent_calendars').insert({id:calendar,property_id:fixture.property,profile_id:fixture.actor,provider:'google',google_email:'current@example.invalid',account_email:'current@example.invalid',provider_subject:'current-subject',access_token:'fixture-current',refresh_token:'fixture-refresh',token_expires_at:new Date(Date.now()+3600000).toISOString(),timezone:'UTC',sync_enabled:true,token_status:'healthy'})).error).toBeNull()
 const request=await start(page,fixture.property)
 await page.goto('/api/lumaleasing/integrations/oauth/google/callback?'+new URLSearchParams({state:request.state,error:'access_denied'}));await expect(page).toHaveURL(/error=authorization_denied/)
 await activity(page,fixture.property);await expect(page.getByRole('heading',{name:'Cancelled connection request',exact:true})).toHaveCount(1);await expect(page.getByText('Authorization was cancelled. You can connect the account again when you are ready.',{exact:true})).toBeVisible()
 expect((await fixture.db.from('agent_calendars').select('access_token,refresh_token,sync_enabled').eq('id',calendar).single()).data).toEqual({access_token:'fixture-current',refresh_token:'fixture-refresh',sync_enabled:true})
 await page.goto('/api/lumaleasing/integrations/oauth/google/callback?'+new URLSearchParams({state:request.state,error:'access_denied'}));await activity(page,fixture.property);await expect(page.getByRole('heading',{name:'Cancelled connection request',exact:true})).toHaveCount(1)
 expect((await fixture.db.from('shared_action_events').select('id').eq('episode_id',request.id)).data).toHaveLength(2);expect(errors).toEqual([]);await page.screenshot({path:info.outputPath('authorization-cancelled-history.png'),fullPage:true})
})
test('external cancellation returns public recovery and distinguishes the client from the sponsor',async({page,fixture},info)=>{
 const token=randomUUID(),invite=randomUUID();expect((await fixture.db.from('integration_auth_invites').insert({id:invite,property_id:fixture.property,provider:'google',requested_capabilities:['calendar'],token_hash:createHash('sha256').update(token).digest('hex'),expires_at:new Date(Date.now()+3600000).toISOString(),created_by_profile_id:fixture.actor})).error).toBeNull()
 const request=await start(page,fixture.property,token)
 await page.goto('/api/lumaleasing/integrations/oauth/google/callback?'+new URLSearchParams({state:request.state,error:'access_denied',error_description:'private-provider-description'}))
 await expect(page).toHaveURL(/lumaleasing\/integrations\/success/);await expect(page.getByRole('heading',{name:'You can reconnect when ready',exact:true})).toBeVisible();await expect(page.getByText('Authorization Complete',{exact:true})).toHaveCount(0);await expect(page.locator('body')).not.toContainText('private-provider-description');await page.screenshot({path:info.outputPath('authorization-public-cancelled.png'),fullPage:true})
 expect((await fixture.db.from('integration_auth_invites').select('consumed_at').eq('id',invite).single()).data?.consumed_at).toBeNull()
 await activity(page,fixture.property);const outcome=page.locator('article').filter({has:page.getByRole('heading',{name:'Cancelled connection request',exact:true})});await expect(outcome).toContainText('External account · invitation sponsored by')
})
test('abandoned requests show system expiry with a reason and their initiating operator',async({page,fixture},info)=>{
 const request=await start(page,fixture.property);expect((await fixture.db.from('integration_authorizations').update({expires_at:new Date(Date.now()-1000).toISOString()}).eq('id',request.id)).error).toBeNull();const expired=await fixture.db.rpc('expire_integration_authorizations',{p_limit:100});expect(expired.error).toBeNull();expect(expired.data.processed).toBe(1)
 await activity(page,fixture.property);const outcome=page.locator('article').filter({has:page.getByRole('heading',{name:'Connection request stopped',exact:true})});await expect(outcome).toContainText('System cleanup · request initiated by you');await expect(outcome).toContainText('This connection request expired. Start a new connection request.');await page.screenshot({path:info.outputPath('authorization-expired-history.png'),fullPage:true})
})
test('an empty public return page never claims completed authorization',async({page})=>{
 await page.goto('/lumaleasing/integrations/success');await expect(page.getByRole('heading',{name:'We could not finish authorization',exact:true})).toBeVisible();await expect(page.getByText('Authorization Complete',{exact:true})).toHaveCount(0);await expect(page.getByText('Authorization could not be confirmed.',{exact:false})).toBeVisible()
})

test('older connection starts remain reachable through activity pagination',async({page,fixture})=>{
 const context={propertyId:fixture.property,profileId:fixture.actor,provider:'google',capabilities:['calendar'],authSource:'dashboard',inviteId:null,tokenHash:null,redirectUri:baseURL+'/fixture',requestedScopes:['https://www.googleapis.com/auth/calendar']}
 for(let index=0;index<55;index++){
  const result=await fixture.db.rpc('begin_integration_authorization',{p_id:randomUUID(),p_context:context});expect(result.error).toBeNull();expect(result.data.state).toBe('ready')
 }
 await page.goto('/dashboard/activity');await page.locator('header select').selectOption(fixture.property);await page.getByLabel('Product',{exact:true}).selectOption('integrations')
 await expect(page.getByRole('heading',{name:'Started connection request',exact:true})).toHaveCount(50)
 await page.getByRole('button',{name:'Load older activity',exact:true}).click();await expect(page.getByRole('heading',{name:'Started connection request',exact:true})).toHaveCount(55)
 await expect(page.getByRole('button',{name:'Load older activity',exact:true})).toHaveCount(0);await expect(page.getByRole('region',{name:'Recorded activity'}).getByRole('alert')).toHaveCount(0)
})
