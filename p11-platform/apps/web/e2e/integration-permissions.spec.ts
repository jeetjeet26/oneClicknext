import {expect,test as base} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const baseURL=process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:9430',databaseURL=process.env.NEXT_PUBLIC_SUPABASE_URL||''
const local=['localhost','127.0.0.1'],client=()=>createClient(databaseURL,process.env.SUPABASE_SERVICE_ROLE_KEY!)
base.skip(!local.includes(new URL(baseURL).hostname),'Local fixtures only')
const test=base.extend<{fixture:{property:string;email:string;calendar:string;db:ReturnType<typeof client>}}>({fixture:async({},provide)=>{
 if(!databaseURL||!local.includes(new URL(databaseURL).hostname))throw new Error('Local database required')
 const db=client(),property=randomUUID(),email=randomUUID(),calendar=randomUUID()
 const save=async(q:PromiseLike<{error:unknown}>)=>{const r=await q;if(r.error)throw r.error}
 try{
  const profile=await db.from('profiles').select('id').eq('org_id','22222222-2222-2222-2222-222222222222').limit(1).single();if(profile.error)throw profile.error
  await save(db.from('properties').insert({id:property,name:'Email credential browser fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{timezone:'UTC'}}))
  await save(db.from('lumaleasing_config').insert({property_id:property,api_key:`local-fixture-${property}`,timezone:'UTC'}))
  await save(db.from('email_configurations').insert({id:email,property_id:property,profile_id:profile.data.id,provider:'microsoft',account_email:'credential@example.invalid',google_email:'credential@example.invalid',access_token:'local-fixture-access',refresh_token:'local-fixture-refresh',token_expires_at:'2099-01-01T00:00:00Z',sync_enabled:true,token_status:'healthy'}))
  await save(db.from('agent_calendars').insert({id:calendar,property_id:property,profile_id:profile.data.id,provider:'google',calendar_id:'fixture-calendar',account_email:'calendar@example.invalid',google_email:'calendar@example.invalid',access_token:'local-fixture-access',refresh_token:'local-fixture-refresh',token_expires_at:'2099-01-01T00:00:00Z',sync_enabled:true,token_status:'healthy',timezone:'UTC'}))
  await provide({property,email,calendar,db})
 }finally{
  execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
  expect((await db.from('properties').select('id').eq('id',property)).data).toHaveLength(0)
 }
}})
test.beforeEach(async({page})=>{await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/)})
async function open(page:import('@playwright/test').Page,property:string){await page.goto('/dashboard/lumaleasing');await page.locator('header select').selectOption(property);await page.getByRole('button',{name:'Configuration',exact:true}).click();await page.getByRole('button',{name:'Lead Capture',exact:true}).click()}

for(const kind of ['calendar','email'] as const){
 test(`${kind} permission health flows from saved records to recovery guidance`,async({page,fixture},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  const table=kind==='calendar'?'agent_calendars':'email_configurations',id=kind==='calendar'?fixture.calendar:fixture.email
  const visit=async()=>{await open(page,fixture.property);if(kind==='calendar')await page.getByRole('button',{name:'Tours',exact:true}).click()}
  await visit();await expect(page.getByText('Permissions need review',{exact:true})).toBeVisible();await expect(page.getByText('Saved permissions are unconfirmed. Reconnect this account to verify access.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Reconnect',exact:true})).toBeVisible()
  const res=await page.request.get(`/api/lumaleasing/${kind}/status?propertyId=${fixture.property}`);expect(res.status()).toBe(200);expect(await res.json()).toMatchObject({connected:false,permission_state:'permissions_unconfirmed'});expect(JSON.stringify(await res.json())).not.toContain('local-fixture-access')
  expect((await fixture.db.from(table).update({scopes:kind==='calendar'?['https://www.googleapis.com/auth/calendar.readonly']:['User.Read','Mail.Read'],provider_metadata:{scopeEvidence:'provider_response'}}).eq('id',id)).error).toBeNull()
  await visit();await expect(page.getByText('Required permissions are missing. Reconnect and grant the requested access.',{exact:true})).toBeVisible()
  await page.getByText('Permissions need review',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`${kind}-permission-hold.png`),fullPage:true})
  expect((await fixture.db.from(table).update({scopes:kind==='calendar'?['https://www.googleapis.com/auth/calendar']:['User.Read','Mail.Read','Mail.Send']}).eq('id',id)).error).toBeNull()
  await visit();await expect(page.getByText('Permissions need review',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Reconnect',exact:true})).toHaveCount(0)
  const ready=await page.request.get(`/api/lumaleasing/${kind}/status?propertyId=${fixture.property}`);expect(await ready.json()).toMatchObject({connected:true,permission_state:'confirmed'});expect(errors).toEqual([])
 })
}
