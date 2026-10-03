import {expect,test as base} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID,createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const dbUrl=process.env.NEXT_PUBLIC_SUPABASE_URL||'',baseURL=process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:9430'
base.skip(!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname),'Local fixtures only')
const client=()=>createClient(dbUrl,process.env.SUPABASE_SERVICE_ROLE_KEY!)
const test=base.extend<{fixture:{db:ReturnType<typeof client>;property:string;actor:string}}>({fixture:async({},provide)=>{
 if(!['localhost','127.0.0.1'].includes(new URL(dbUrl).hostname))throw new Error('Local database required')
 const db=client(),property=randomUUID();const actorResult=await db.from('profiles').select('id').eq('org_id','22222222-2222-2222-2222-222222222222').limit(1).single();if(actorResult.error)throw actorResult.error;const actor=actorResult.data.id
 try{
  const p=await db.from('properties').insert({id:property,name:'Authorization browser fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{timezone:'UTC'}});if(p.error)throw p.error
  const w=await db.from('lumaleasing_config').insert({property_id:property,api_key:`fixture-${property}`,timezone:'UTC'});if(w.error)throw w.error
  await provide({db,property,actor})
 }finally{
  execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
  expect((await db.from('properties').select('id').eq('id',property)).data).toHaveLength(0)
 }
}})
test.beforeEach(async({page})=>{await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/)})
const context=(s:Record<string,unknown>)=>({propertyId:s.propertyId,profileId:s.profileId||null,provider:s.provider,capabilities:s.capabilities,authSource:s.authSource,inviteId:s.inviteId||null,tokenHash:s.tokenHash||null,redirectUri:s.redirectUri,requestedScopes:s.requestedScopes})
async function begin(page:import('@playwright/test').Page,query:string){
 const response=await page.request.get(`/api/lumaleasing/integrations/oauth/google/start?${query}`,{maxRedirects:0});expect(response.status()).toBe(307)
 const location=new URL(response.headers().location),state=location.searchParams.get('state')!,payload=JSON.parse(Buffer.from(state.split('.')[0],'base64url').toString())
 return {state,payload,args:{p_id:payload.requestId,p_context:context(payload)}}
}
const grant={accessToken:'local-fixture-access',refreshToken:'local-fixture-refresh',accountEmail:'authorized@example.invalid',subject:'fixture-subject',timezone:'UTC',scopes:['https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/gmail.modify'],scopeEvidence:'provider_response'}
test('saved callback reopens once and a later callback cannot undo email removal',async({page,fixture},info)=>{
 const attempt=await begin(page,`propertyId=${fixture.property}&capabilities=calendar,email`)
 const claim=await fixture.db.rpc('claim_integration_authorization',attempt.args);expect(claim.error).toBeNull();expect(claim.data.state).toBe('claimed')
 const result=await fixture.db.rpc('finish_integration_authorization',{...attempt.args,p_grant:{...grant,expiresAt:new Date(Date.now()+3600000).toISOString()}});expect(result.error).toBeNull();expect(result.data.state).toBe('saved')
 const callback=`/api/lumaleasing/integrations/oauth/google/callback?code=already-exchanged-fixture&state=${encodeURIComponent(attempt.state)}`
 await page.goto(callback);await expect(page).toHaveURL(/success=calendar_connected/);await expect(page.locator('header select')).toHaveValue(fixture.property)
 await page.goto('/dashboard/activity');await page.getByLabel('Product',{exact:true}).selectOption('integrations');await expect(page.getByRole('heading',{name:'Authorized integration',exact:true})).toHaveCount(1);await expect(page.locator('body')).not.toContainText('local-fixture-access');await page.screenshot({path:info.outputPath('integration-authorization-history.png'),fullPage:true})
 // Remove through the actual authenticated API, then replay the old callback.
 const removal=await page.request.post('/api/lumaleasing/email/disconnect',{data:{propertyId:fixture.property,provider:'google',requestId:randomUUID()}});expect(removal.status()).toBe(200);expect((await removal.json()).actionEventId).toBeTruthy()
 await page.goto(callback);await expect(page).toHaveURL(/error=connection_changed/);await expect(page.getByText('The saved connection changed while authorization was in progress.',{exact:false})).toBeVisible()
 expect((await fixture.db.from('email_configurations').select('access_token,sync_enabled').eq('property_id',fixture.property).single()).data).toEqual({access_token:null,sync_enabled:false})
 expect((await fixture.db.from('shared_action_events').select('id').eq('property_id',fixture.property).eq('action','integration.authorization.completed')).data).toHaveLength(1)
})
test('external invitation records its own authorizer and cannot be reused',async({page,fixture},info)=>{
 const invite=randomUUID(),token=randomUUID()+randomUUID();const saved=await fixture.db.from('integration_auth_invites').insert({id:invite,property_id:fixture.property,provider:'google',requested_capabilities:['calendar'],token_hash:createHash('sha256').update(token).digest('hex'),expires_at:new Date(Date.now()+3600000).toISOString(),created_by_profile_id:fixture.actor});expect(saved.error).toBeNull()
 const attempt=await begin(page,`token=${token}`);expect((await fixture.db.rpc('claim_integration_authorization',attempt.args)).data.state).toBe('claimed')
 expect((await fixture.db.rpc('finish_integration_authorization',{...attempt.args,p_grant:{...grant,expiresAt:new Date(Date.now()+3600000).toISOString()}})).data.state).toBe('saved')
 await page.goto(`/api/lumaleasing/integrations/oauth/google/callback?code=already-exchanged-fixture&state=${encodeURIComponent(attempt.state)}`);await expect(page).toHaveURL(/lumaleasing\/integrations\/success/);await expect(page.getByRole('heading',{name:'Authorization Complete'})).toBeVisible()
 expect((await page.request.get(`/api/lumaleasing/integrations/oauth/google/start?token=${token}`,{maxRedirects:0})).status()).toBe(400)
 await page.goto('/dashboard/lumaleasing');await page.locator('header select').selectOption(fixture.property);await page.goto('/dashboard/activity');await page.getByLabel('Product',{exact:true}).selectOption('integrations');await expect(page.getByText('External account (authorized by invitation)',{exact:false})).toBeVisible();await page.screenshot({path:info.outputPath('integration-invitation-history.png'),fullPage:true})
 const event=await fixture.db.from('shared_action_events').select('request,training_eligible').eq('id',attempt.payload.requestId).single();expect(event.data?.training_eligible).toBe(false);expect(event.data?.request.authorizer).toBe('external_account')
})
