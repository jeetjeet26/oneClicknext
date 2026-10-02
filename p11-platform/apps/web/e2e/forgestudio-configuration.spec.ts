import { expect, test as base } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const dbURL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const local = ['127.0.0.1','localhost']
const client = () => createClient(dbURL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
type Fixture = { property: string; lead: string; second: string; actor: string; db: ReturnType<typeof client> }
const test = base.extend<{ fixture: Fixture }>({ fixture: async ({}, provide) => {
 if(!dbURL || !local.includes(new URL(dbURL).hostname) || !local.includes(new URL(process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430').hostname)) throw new Error('Isolated local test required')
 const db = client(), property = randomUUID(), lead = randomUUID(), second = randomUUID()
 const check = async (promise: PromiseLike<{ error: unknown }>) => { const r = await promise; if(r.error)throw r.error }
 try {
  const actor = await db.from('profiles').select('id').eq('org_id','22222222-2222-2222-2222-222222222222').eq('role','admin').limit(1).single();if(actor.error)throw actor.error
  await check(db.from('properties').insert({ id: property, org_id: '22222222-2222-2222-2222-222222222222', name: 'ForgeStudio configuration browser fixture', property_type: 'multifamily' }))
  await check(db.from('leads').insert([{id:lead,property_id:property,first_name:'CRM One',email:'leadpulse-one@fixture.invalid',source:'referral'},{id:second,property_id:property,first_name:'CRM Two',source:'website form'}]))
  await provide({ property, lead, second, actor: actor.data.id, db })
 } finally {
  execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; CREATE TEMP TABLE crm_fixture_jobs ON COMMIT DROP AS SELECT id FROM public.shared_jobs WHERE property_id='${property}'; CREATE TEMP TABLE crm_fixture_leads ON COMMIT DROP AS SELECT id FROM public.leads WHERE property_id='${property}'; UPDATE public.leads SET property_id=NULL WHERE property_id='${property}'; DELETE FROM public.properties WHERE id='${property}'; DELETE FROM public.shared_jobs WHERE id IN (SELECT id FROM crm_fixture_jobs); DELETE FROM public.leads WHERE id IN (SELECT id FROM crm_fixture_leads); COMMIT;`,stdio:['pipe','pipe','pipe']})
  expect((await db.from('properties').select('id').eq('id', property)).data).toHaveLength(0)
  expect((await db.from('forgestudio_measurements').select('id').eq('property_id',property)).data).toHaveLength(0)
  expect((await db.from('social_attribution_events').select('id').eq('property_id',property)).data).toHaveLength(0)
 }
} })
test.beforeEach(async ({page}) => { await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/) })

const settings=(page:import('@playwright/test').Page)=>page.getByRole('region',{name:'Studio settings'})
async function openSettings(page:import('@playwright/test').Page,f:Fixture){await page.addInitScript(p=>localStorage.setItem('p11_selected_property_id',p),f.property);await page.goto('/dashboard/forgestudio?tab=settings');await expect(settings(page).getByRole('form',{name:'Studio preferences'})).toBeVisible()}
const prefs={brand_voice:'Clear and welcoming',target_audience:'Outdoor spaces',key_amenities:['Pool'],include_hashtags:false,include_cta:false,max_caption_length:180}
async function saveDirect(page:import('@playwright/test').Page,f:Fixture,version:number,voice:string){const r=await page.request.post('/api/forgestudio/config',{data:{propertyId:f.property,requestId:randomUUID(),expectedVersion:version,config:{...prefs,brand_voice:voice}}});expect(r.status()).toBe(200);return r.json()}

test('settings save one decision after a lost response and retain only supported preferences',async({page,fixture},info)=>{
 await openSettings(page,fixture);expect((await fixture.db.from('forgestudio_config').select('id').eq('property_id',fixture.property)).data).toHaveLength(0)
 await settings(page).getByLabel('Brand voice',{exact:true}).fill(prefs.brand_voice);await settings(page).getByLabel('Audience interests').fill(prefs.target_audience);await settings(page).getByLabel('Amenity topics (comma-separated)',{exact:true}).fill('Pool, roof deck');await settings(page).getByLabel('Allow hashtags in generated drafts').uncheck();await settings(page).getByLabel('Allow a call-to-action in generated drafts').uncheck();await settings(page).getByLabel('Maximum caption length').fill('180')
 let lost=true;await page.route('**/api/forgestudio/config',async route=>{if(route.request().method()==='POST'&&lost){lost=false;expect((await route.fetch()).status()).toBe(200);await route.abort('connectionreset')}else await route.continue()})
 await settings(page).getByRole('button',{name:'Save settings',exact:true}).click();await expect(settings(page).getByRole('alert')).toBeVisible();await expect(settings(page).getByLabel('Brand voice',{exact:true})).toHaveValue(prefs.brand_voice);await settings(page).getByRole('button',{name:'Save settings',exact:true}).click();await expect(settings(page).getByRole('status')).toContainText('Settings saved.')
 const rows=(await fixture.db.from('forgestudio_config').select('*').eq('property_id',fixture.property)).data!;expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({...prefs,configuration_version:1,key_amenities:['Pool','roof deck']});expect((await fixture.db.from('shared_action_events').select('*').eq('property_id',fixture.property).eq('action','studio.configuration.saved')).data).toHaveLength(1)
 await page.reload();await expect(settings(page).getByLabel('Maximum caption length')).toHaveValue('180');await expect(settings(page).getByLabel('Allow hashtags in generated drafts')).not.toBeChecked();await expect(settings(page).getByText('Creativity Level',{exact:false})).toHaveCount(0)
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await settings(page).screenshot({path:info.outputPath('forgestudio-settings-mobile.png')})
})

test('stale forms preserve their text and cannot overwrite a newer saved decision',async({page,fixture})=>{
 await openSettings(page,fixture);await settings(page).getByLabel('Brand voice',{exact:true}).fill('My older draft');await saveDirect(page,fixture,0,'Other saved voice');await settings(page).getByRole('button',{name:'Save settings',exact:true}).click();await expect(settings(page).getByRole('alert')).toContainText('These settings changed');await expect(settings(page).getByLabel('Brand voice',{exact:true})).toHaveValue('My older draft');expect((await fixture.db.from('forgestudio_config').select('brand_voice').eq('property_id',fixture.property).single()).data?.brand_voice).toBe('Other saved voice');await settings(page).getByRole('button',{name:'Reload saved settings'}).click();await expect(settings(page).getByLabel('Brand voice',{exact:true})).toHaveValue('Other saved voice');await settings(page).getByLabel('Brand voice',{exact:true}).fill('Reviewed updated voice');await settings(page).getByRole('button',{name:'Save settings',exact:true}).click();await expect(settings(page).getByRole('status')).toContainText('Settings saved.')
})

test('a failed settings read remains visible and cannot be mistaken for editable defaults',async({page,fixture})=>{
 await page.addInitScript(p=>localStorage.setItem('p11_selected_property_id',p),fixture.property);await page.route('**/api/forgestudio/config?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Saved studio settings unavailable'})}));await page.goto('/dashboard/forgestudio?tab=settings');await expect(settings(page).getByRole('alert')).toHaveText('Saved studio settings unavailable');await expect(settings(page).getByRole('form')).toHaveCount(0);await page.unroute('**/api/forgestudio/config?*');await settings(page).getByRole('button',{name:'Reload saved settings'}).click();await expect(settings(page).getByRole('form')).toBeVisible();expect((await fixture.db.from('forgestudio_config').select('id').eq('property_id',fixture.property)).data).toHaveLength(0)
})


test('a delayed response from the previous property cannot replace the selected settings',async({page,fixture})=>{
 let release:()=>void=()=>{},received:()=>void=()=>{};const waiting=new Promise<void>(resolve=>{received=resolve}),delayed=new Promise<void>(resolve=>{release=resolve})
 await page.addInitScript(p=>localStorage.setItem('p11_selected_property_id',p),fixture.property)
 await page.route('**/api/forgestudio/config?*',async route=>{
  const old=new URL(route.request().url()).searchParams.get('propertyId')===fixture.property
  if(old){received();await delayed}
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({version:0,isDefault:true,config:{...prefs,brand_voice:old?'Old property delayed response':'Selected property preferences'}})}).catch(()=>{})
 })
 try{await page.goto('/dashboard/forgestudio?tab=settings');await waiting;await page.getByRole('combobox',{name:'Property',exact:true}).selectOption('33333333-3333-3333-3333-333333333333');await expect(settings(page).getByLabel('Brand voice',{exact:true})).toHaveValue('Selected property preferences');release();await expect(settings(page).getByLabel('Brand voice',{exact:true})).toHaveValue('Selected property preferences')}finally{release()}
})
