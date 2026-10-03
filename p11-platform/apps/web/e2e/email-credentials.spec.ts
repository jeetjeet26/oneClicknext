import {expect,test as base} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const baseURL=process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:9430',databaseURL=process.env.NEXT_PUBLIC_SUPABASE_URL||''
const local=['localhost','127.0.0.1'],client=()=>createClient(databaseURL,process.env.SUPABASE_SERVICE_ROLE_KEY!)
base.skip(!local.includes(new URL(baseURL).hostname),'Local fixtures only')
const test=base.extend<{fixture:{property:string;email:string;db:ReturnType<typeof client>}}>({fixture:async({},provide)=>{
 if(!databaseURL||!local.includes(new URL(databaseURL).hostname))throw new Error('Local database required')
 const db=client(),property=randomUUID(),email=randomUUID()
 const save=async(q:PromiseLike<{error:unknown}>)=>{const r=await q;if(r.error)throw r.error}
 try{
  const profile=await db.from('profiles').select('id').eq('org_id','22222222-2222-2222-2222-222222222222').limit(1).single();if(profile.error)throw profile.error
  await save(db.from('properties').insert({id:property,name:'Email credential browser fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{timezone:'UTC'}}))
  await save(db.from('lumaleasing_config').insert({property_id:property,api_key:`local-fixture-${property}`,timezone:'UTC'}))
  await save(db.from('email_configurations').insert({id:email,property_id:property,profile_id:profile.data.id,provider:'microsoft',account_email:'credential@example.invalid',google_email:'credential@example.invalid',access_token:'local-fixture-access',refresh_token:'local-fixture-refresh',token_expires_at:'2099-01-01T00:00:00Z',sync_enabled:true,token_status:'healthy',scopes:['https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/gmail.modify','User.Read','Calendars.ReadWrite','Mail.Read','Mail.Send'],provider_metadata:{scopeEvidence:'provider_response'}}))
  await provide({property,email,db})
 }finally{
  execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
  expect((await db.from('properties').select('id').eq('id',property)).data).toHaveLength(0)
 }
}})
test.beforeEach(async({page})=>{await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/)})
async function open(page:import('@playwright/test').Page,property:string){await page.goto('/dashboard/lumaleasing');await page.locator('header select').selectOption(property);await page.getByRole('button',{name:'Configuration',exact:true}).click();await page.getByRole('button',{name:'Lead Capture',exact:true}).click()}
test('recorded disconnect recovers a lost response and rejects a late token refresh',async({page,fixture},info)=>{
 const attempt=randomUUID(),claim=await fixture.db.rpc('claim_email_token_refresh',{p_property_id:fixture.property,p_email_id:fixture.email,p_version:1,p_identity:{provider:'microsoft',accountEmail:'credential@example.invalid',subject:null,tenant:null},p_request_id:attempt,p_force:true});expect(claim.error).toBeNull();expect(claim.data.state).toBe('claimed')
 let lost=true;const ids:string[]=[],dialogs:string[]=[]
 page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept()})
 await page.route('**/api/lumaleasing/email/disconnect',async route=>{
  ids.push(route.request().postDataJSON().requestId)
  if(lost){lost=false;const actual=await route.fetch();expect(actual.status()).toBe(200);return route.fulfill({status:503,json:{error:'Disconnection response lost. Retry the same request.'}})}
  return route.continue()
 })
 await open(page,fixture.property);await page.getByRole('button',{name:'Remove Email Account',exact:true}).click()
 await expect.poll(()=>dialogs.some(message=>message.includes('response lost'))).toBe(true)
 await expect(page.getByRole('button',{name:'Remove Email Account',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Remove Email Account',exact:true}).click();await expect(page.getByRole('button',{name:'Remove Email Account',exact:true})).toHaveCount(0)
 expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1])
 const late=await fixture.db.rpc('finish_email_token_refresh',{p_property_id:fixture.property,p_email_id:fixture.email,p_request_id:attempt,p_outcome:'success',p_tokens:{accessToken:'late-fixture-token',refreshToken:'late-fixture-refresh',expiresAt:new Date(Date.now()+3600000).toISOString()}});expect(late.error).toBeNull();expect(late.data.state).toBe('connection_changed')
 expect((await fixture.db.from('email_configurations').select('access_token,refresh_token,sync_enabled,token_status').eq('id',fixture.email).single()).data).toEqual({access_token:null,refresh_token:null,sync_enabled:false,token_status:'disconnected'})
 const events=await fixture.db.from('shared_action_events').select('id,training_eligible,before_state,after_state').eq('property_id',fixture.property).eq('action','email.disconnected');expect(events.data).toHaveLength(1);expect(events.data?.[0]).toMatchObject({id:ids[0],training_eligible:false});expect(JSON.stringify(events.data)).not.toContain('local-fixture-access')
 await page.goto('/dashboard/activity');await page.getByLabel('Product',{exact:true}).selectOption('integrations');await expect(page.getByRole('heading',{name:'Disconnected email',exact:true})).toHaveCount(1)
 await page.screenshot({path:info.outputPath('email-disconnect-history.png'),fullPage:true})
})
test('uncertain refresh shows reconnect guidance without exposing credentials',async({page,fixture},info)=>{
 expect((await fixture.db.from('email_configurations').update({token_status:'refresh_unconfirmed'}).eq('id',fixture.email)).error).toBeNull()
 await open(page,fixture.property);await expect(page.getByText('Renewal unconfirmed',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Reconnect',exact:true})).toBeVisible();await expect(page.getByText('Automatic Outlook notifications are not available.',{exact:false})).toBeVisible();await expect(page.locator('body')).not.toContainText('missing_watch_channel');await expect(page.locator('body')).not.toContainText('local-fixture-access');await page.getByRole('button',{name:'Reconnect',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('email-renewal-unconfirmed.png'),fullPage:true})
})

test('failed email status stays unavailable and recovers on retry',async({page,fixture})=>{
 let unavailable=true
 await page.route('**/api/lumaleasing/email/status?*',async route=>unavailable?route.fulfill({status:503,json:{error:'Fixture unavailable'}}):route.continue())
 await open(page,fixture.property);await expect(page.getByText('Email status is unavailable. Retry before changing this connection.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Remove Email Account',exact:true})).toHaveCount(0)
 unavailable=false;await page.getByRole('button',{name:'Retry email status',exact:true}).click();await expect(page.getByRole('button',{name:'Remove Email Account',exact:true})).toBeVisible();await expect(page.getByText('Email status is unavailable. Retry before changing this connection.',{exact:true})).toHaveCount(0)
})
