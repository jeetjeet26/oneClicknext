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
   await save(db.from('properties').insert({id:property,name:'Calendar setup browser fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{}}))
   await save(db.from('agent_calendars').insert({profile_id:profile.data.id,property_id:property,provider:'google',google_email:'calendar@example.invalid',account_email:'calendar@example.invalid',access_token:'local-fixture-only',refresh_token:'local-fixture-only',token_expires_at:'2099-01-01T00:00:00Z',token_status:'healthy',timezone:null,sync_enabled:true}))
   await save(db.from('lumaleasing_config').upsert({property_id:property,api_key:`local_fixture_${randomUUID()}`},{onConflict:'property_id',ignoreDuplicates:true}))
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
test('saved timezone survives a lost response with one action record and no invented default',async({page,fixture},info)=>{
 await page.setViewportSize({width:390,height:844})
 const ids:string[]=[];let lost=true
 await page.route('**/api/tours/timezone',async route=>{
  ids.push(route.request().postDataJSON().requestId)
  if(lost){lost=false;const response=await route.fetch();expect(response.status()).toBe(200);return route.fulfill({status:503,json:{error:'The timezone response was lost. Retry the same choice.'}})}
  return route.continue()
 })
 await page.goto('/dashboard/lumaleasing');await page.locator('header select').selectOption(fixture.property)
 await page.getByRole('button',{name:'Configuration',exact:true}).click();await page.getByRole('button',{name:'Tours',exact:true}).click()
 const setup=page.getByRole('region',{name:'Calendar timezone setup'})
 await expect(setup).toBeVisible();await expect(setup.getByLabel('Property timezone',{exact:true})).toHaveValue('')
 await expect(setup.getByRole('button',{name:'Save property timezone'})).toBeDisabled()
 await setup.getByLabel('Property timezone',{exact:true}).fill('America/New_York');await setup.getByRole('button',{name:'Save property timezone'}).click()
 await expect(setup.getByRole('alert')).toContainText('response was lost')
 await setup.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('calendar-timezone-retry-mobile.png'),fullPage:true})
 await setup.getByRole('button',{name:'Save property timezone'}).click()
 await expect(page.getByText('Tour timezone: America/New_York',{exact:true})).toBeVisible();await expect(setup).toBeHidden()
 expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1])
 const events=await fixture.db.from('shared_action_events').select('id,actor_id,before_state,after_state,training_eligible').eq('property_id',fixture.property).eq('action','tour.timezone.set')
 expect(events.error).toBeNull();expect(events.data).toHaveLength(1);expect(events.data![0]).toMatchObject({id:ids[0],before_state:{timezone:null},after_state:{timezone:'America/New_York'},training_eligible:false})
 await page.reload();await page.getByRole('button',{name:'Configuration',exact:true}).click();await page.getByRole('button',{name:'Tours',exact:true}).click();await expect(page.getByText('Tour timezone: America/New_York',{exact:true})).toBeVisible()
})
test('OAuth return opens the saved property and setup stays available after a failed status read',async({page,fixture},info)=>{
 let fail=true
 await page.route('**/api/lumaleasing/calendar/status?*',route=>fail?route.fulfill({status:503,json:{error:'Fixture outage'}}):route.continue())
 await page.goto(`/dashboard/lumaleasing?success=calendar_setup_required&propertyId=${fixture.property}`)
 await expect(page.locator('header select')).toHaveValue(fixture.property)
 const retry=page.getByRole('button',{name:'Retry Google Calendar status',exact:true})
 await expect(retry).toBeVisible()
 const googleCard=page.getByRole('heading',{name:'Google Calendar',exact:true}).locator('xpath=../../..')
 await expect(googleCard.getByRole('button',{name:'Connect',exact:true})).toBeDisabled()
 fail=false;await retry.click()
 const setup=page.getByRole('region',{name:'Calendar timezone setup'});await expect(setup).toBeVisible()
 await setup.getByLabel('Property timezone',{exact:true}).fill('Bad/Timezone');await setup.getByRole('button',{name:'Save property timezone'}).click();await expect(setup.getByRole('alert')).toContainText('valid timezone')
 await setup.getByLabel('Property timezone',{exact:true}).fill('Asia/Kolkata');await setup.getByRole('button',{name:'Save property timezone'}).click();await expect(page.getByText('Tour timezone: Asia/Kolkata',{exact:true})).toBeVisible()
 await expect(page.getByText('Switching property',{exact:true})).toBeHidden()
 await page.screenshot({path:info.outputPath('calendar-timezone-integrations.png'),fullPage:true})
 const settings=await fixture.db.from('properties').select('settings').eq('id',fixture.property).single();expect(settings.data?.settings.timezone).toBe('Asia/Kolkata')
})
test('external authorization completion names the remaining timezone step',async({page},info)=>{
 await page.goto('/lumaleasing/integrations/success?success=calendar_setup_required&provider=microsoft&email=fixture%40example.invalid')
 await expect(page.getByRole('heading',{name:'One setup step remains'})).toBeVisible();await expect(page.getByText('Ask your P11 contact to choose the property timezone before scheduling tours.',{exact:false})).toBeVisible()
 await page.screenshot({path:info.outputPath('external-timezone-setup.png'),fullPage:true})
})
