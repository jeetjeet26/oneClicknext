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
  await check(db.from('properties').insert({ id: property, org_id: '22222222-2222-2222-2222-222222222222', name: 'ForgeStudio generation browser fixture', property_type: 'multifamily' }))
  await check(db.from('leads').insert([{id:lead,property_id:property,first_name:'CRM One',email:'leadpulse-one@fixture.invalid',source:'referral'},{id:second,property_id:property,first_name:'CRM Two',source:'website form'}]))
  await provide({ property, lead, second, actor: actor.data.id, db })
 } finally {
  execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; CREATE TEMP TABLE crm_fixture_jobs ON COMMIT DROP AS SELECT id FROM public.shared_jobs WHERE property_id='${property}'; CREATE TEMP TABLE crm_fixture_leads ON COMMIT DROP AS SELECT id FROM public.leads WHERE property_id='${property}'; UPDATE public.leads SET property_id=NULL WHERE property_id='${property}'; DELETE FROM public.properties WHERE id='${property}'; DELETE FROM public.shared_jobs WHERE id IN (SELECT id FROM crm_fixture_jobs); DELETE FROM public.leads WHERE id IN (SELECT id FROM crm_fixture_leads); COMMIT;`,stdio:['pipe','pipe','pipe']})
  expect((await db.from('properties').select('id').eq('id', property)).data).toHaveLength(0)
 }
} })
test.beforeEach(async ({page}) => { await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/) })


async function rpc(f:Fixture,name:string,args:Record<string,unknown>){const r=await f.db.rpc(name,args);if(r.error)throw r.error;return r.data}


async function seedGeneration(f:Fixture,withResult:boolean){
 const brief=randomUUID(),generation=randomUUID()
 expect((await rpc(f,'save_forgestudio_brief',{p_id:brief,p_property_id:f.property,p_actor_id:f.actor,p_payload:{title:'Saved generation journey',objective:'Explain the community',channels:['facebook'],formatPlan:[{platform:'facebook',contentFormat:'text',quantity:1}]}})).state).toBe('saved')
 const started=await rpc(f,'begin_forgestudio_generation',{p_id:generation,p_property_id:f.property,p_actor_id:f.actor,p_brief_id:brief});expect(started.state).toBe('claimed')
 const args={p_id:generation,p_claim_token:started.claimToken}
 const bundle={version:'forgestudio.context.v1',propertyId:f.property,assembledAt:new Date().toISOString(),sources:[],assets:[],brandVoice:null,targetAudience:null,warnings:[],policy:{legalConfigId:null,fairHousingRequired:true,sensitiveClaimsRequireApproval:true},contextHash:'fixture-context'}
 expect((await rpc(f,'advance_forgestudio_generation',{...args,p_action:'context',p_payload:{bundle,objective:'Explain the community',channels:['facebook'],formatPlan:[{platform:'facebook',contentFormat:'text',quantity:1}]}})).state).toBe('saved')
 expect((await rpc(f,'advance_forgestudio_generation',{...args,p_action:'model_intent',p_payload:{}})).state).toBe('proceed_once')
 const raw={output:{conceptSummary:'Recovered generated campaign',variants:[{variantKey:'facebook:text:1',sequenceIndex:0,platform:'facebook',caption:'Welcome to this community.',hashtags:[],callToAction:null,altText:null,contentFormat:'text',selectedAssetId:null,selectedAssetIds:[],storyboard:[],overlayText:[],safeArea:{topPercent:10,rightPercent:8,bottomPercent:18,leftPercent:8},subtitleText:null,thumbnailAssetId:null}],claims:[]},metadata:{model:'isolated-fixture-model',promptVersion:'forgestudio.generation.v1',contractVersion:'forgestudio.social.v1',contextHash:'fixture-context',modelPolicyVersion:'fixture-policy',tier:'quality',usage:{inputTokens:10,outputTokens:20,totalTokens:30},finishReason:'stop',warnings:[],providerMetadata:{}}}
 if(withResult)expect((await rpc(f,'advance_forgestudio_generation',{...args,p_action:'raw_result',p_payload:raw})).state).toBe('saved')
 else expect((await rpc(f,'advance_forgestudio_generation',{...args,p_action:'failure',p_payload:{code:'model_uncertain'}})).state).toBe('saved')
 return{brief,generation,args,raw}
}
async function openRequests(page:import('@playwright/test').Page,f:Fixture){await page.addInitScript(p=>localStorage.setItem('p11_selected_property_id',p),f.property);await page.route('**/api/forgestudio/briefs/*/generate',route=>{throw new Error('Recovery must never call a generation endpoint: '+route.request().url())});await page.goto('/dashboard/forgestudio?tab=campaigns');await expect(page.getByRole('region',{name:'Saved generation requests'})).toBeVisible()}
const panel=(page:import('@playwright/test').Page)=>page.getByRole('region',{name:'Saved generation requests'})
test('recover a saved model result after reload and a lost response without another model invocation',async({page,fixture},info)=>{
 const seed=await seedGeneration(fixture,true);await openRequests(page,fixture)
 await expect(panel(page).getByText('Result saved — ready to recover',{exact:false})).toBeVisible()
 let lost=true;await page.route('**/api/forgestudio/generations/*',async route=>{if(route.request().method()==='POST'&&lost){lost=false;const saved=await route.fetch();expect(saved.status()).toBe(200);await route.abort('connectionreset')}else await route.continue()})
 await panel(page).getByRole('button',{name:'Recover saved result'}).click();await expect(panel(page).getByRole('alert')).toBeVisible();await panel(page).getByRole('button',{name:'Recover saved result'}).click();await expect(page.getByRole('dialog',{name:'Review Studio'})).toBeVisible();await expect(page.getByText('Welcome to this community.',{exact:true})).toBeVisible()
 expect((await fixture.db.from('social_content_packages').select('id').eq('brief_id',seed.brief)).data).toHaveLength(1);expect((await fixture.db.from('forgestudio_generation_receipts').select('kind').eq('generation_id',seed.generation).eq('kind','model_intent')).data).toHaveLength(1)
 expect((await fixture.db.from('shared_action_events').select('id').eq('property_id',fixture.property).eq('action','studio.generation.recovered')).data).toHaveLength(1)
 await page.reload();await expect(panel(page).getByRole('button',{name:'Open saved draft'})).toBeVisible();await page.setViewportSize({width:390,height:844});await panel(page).scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await panel(page).screenshot({path:info.outputPath('forgestudio-generation-mobile.png')})
})
test('stop an uncertain request, recover the lost decision and retain a late result without applying it',async({page,fixture})=>{
 const seed=await seedGeneration(fixture,false);await openRequests(page,fixture);await expect(panel(page).getByText('The model response is uncertain.',{exact:false})).toBeVisible();await panel(page).getByRole('button',{name:'Stop this request'}).click();await panel(page).getByLabel('Reason for stopping').fill('Keep the uncertain attempt on hold before revising the brief')
 let lost=true;await page.route('**/api/forgestudio/generations/*',async route=>{if(lost){lost=false;const saved=await route.fetch();expect(saved.status()).toBe(200);await route.abort('connectionreset')}else await route.continue()})
 await panel(page).getByRole('button',{name:'Save stop decision'}).click();await expect(panel(page).getByRole('alert')).toBeVisible();await panel(page).getByRole('button',{name:'Save stop decision'}).click();await expect(panel(page).getByText('Stopped by an operator',{exact:false})).toBeVisible()
 expect((await rpc(fixture,'advance_forgestudio_generation',{...seed.args,p_action:'raw_result',p_payload:seed.raw})).generationState).toBe('stopped');await panel(page).getByRole('button',{name:'Reload generation requests'}).click();await expect(panel(page).getByText('A result arrived after the stop',{exact:false})).toBeVisible();await expect(panel(page).getByRole('button',{name:'Recover saved result'})).toHaveCount(0)
 expect((await fixture.db.from('social_content_packages').select('id').eq('brief_id',seed.brief)).data).toHaveLength(0);expect((await fixture.db.from('shared_action_events').select('id').eq('property_id',fixture.property).eq('action','studio.generation.stopped')).data).toHaveLength(1)
})
test('failed request history loads remain explicit and reloadable',async({page,fixture})=>{
 await seedGeneration(fixture,true);await page.route('**/api/forgestudio/generations?**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Saved request history unavailable'})}));await openRequests(page,fixture);await expect(panel(page).getByRole('alert')).toHaveText('Saved request history unavailable');await expect(panel(page).getByText('No saved generation requests yet.')).toHaveCount(0);await page.unroute('**/api/forgestudio/generations?**');await panel(page).getByRole('button',{name:'Reload generation requests'}).click();await expect(panel(page).getByRole('button',{name:'Recover saved result'})).toBeVisible()
})
