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
  await check(db.from('properties').insert({ id: property, org_id: '22222222-2222-2222-2222-222222222222', name: 'ForgeStudio editorial browser fixture', property_type: 'multifamily' }))
  await check(db.from('leads').insert([{id:lead,property_id:property,first_name:'CRM One',email:'leadpulse-one@fixture.invalid',source:'referral'},{id:second,property_id:property,first_name:'CRM Two',source:'website form'}]))
  await provide({ property, lead, second, actor: actor.data.id, db })
 } finally {
  execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; CREATE TEMP TABLE crm_fixture_jobs ON COMMIT DROP AS SELECT id FROM public.shared_jobs WHERE property_id='${property}'; CREATE TEMP TABLE crm_fixture_leads ON COMMIT DROP AS SELECT id FROM public.leads WHERE property_id='${property}'; UPDATE public.leads SET property_id=NULL WHERE property_id='${property}'; DELETE FROM public.properties WHERE id='${property}'; DELETE FROM public.shared_jobs WHERE id IN (SELECT id FROM crm_fixture_jobs); DELETE FROM public.leads WHERE id IN (SELECT id FROM crm_fixture_leads); COMMIT;`,stdio:['pipe','pipe','pipe']})
  expect((await db.from('properties').select('id').eq('id', property)).data).toHaveLength(0)
 }
} })
test.beforeEach(async ({page}) => { await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/) })


async function rpc(f:Fixture,name:string,args:Record<string,unknown>){const r=await f.db.rpc(name,args);if(r.error)throw r.error;return r.data}


async function seeded(f:Fixture){
 const content={contractVersion:'forgestudio.social.v1',conceptSummary:'Saved editorial campaign',variants:[{variantKey:'primary',sequenceIndex:0,platform:'facebook',caption:'Welcome to this community.',hashtags:[],assetIds:[],mediaUrls:[],contentFormat:'text',linkUrl:'https://example.invalid/community',storyboard:[],overlayText:[],safeArea:{topPercent:10,rightPercent:8,bottomPercent:18,leftPercent:8}}],claims:[]}
 const id=randomUUID(),result=await rpc(f,'save_forgestudio_revision',{p_id:id,p_property_id:f.property,p_actor_id:f.actor,p_payload:{content,authorKind:'user',validation:[[]]}});expect(result.state).toBe('saved');return{id,packageId:result.packageId,content}
}
async function openCampaign(page:import('@playwright/test').Page,f:Fixture){await page.addInitScript(p=>localStorage.setItem('p11_selected_property_id',p),f.property);await page.goto('/dashboard/forgestudio?tab=campaigns');await page.getByRole('button').filter({hasText:'Saved editorial campaign'}).click();await expect(page.getByRole('dialog',{name:'Review Studio'})).toBeVisible()}
const dialog=(page:import('@playwright/test').Page)=>page.getByRole('dialog',{name:'Review Studio'})
test('lost edit and approval responses recover saved revisions, preserve links and record each decision once',async({page,fixture},info)=>{
 const seed=await seeded(fixture);await openCampaign(page,fixture)
 await dialog(page).getByRole('button',{name:'Edit facebook caption'}).click();await dialog(page).getByRole('textbox',{name:'facebook caption',exact:true}).fill('Explore the community with our team.')
 await expect(dialog(page).getByRole('button',{name:'Save as revision 2'})).toBeDisabled();await dialog(page).getByLabel('Reason for this revision').fill('Clarify the next step')
 let lostEdit=true
 await page.route('**/api/forgestudio/packages/*/revisions',async route=>{if(route.request().method()==='POST'&&lostEdit){lostEdit=false;const saved=await route.fetch();expect(saved.status()).toBe(201);await route.abort('connectionreset')}else await route.continue()})
 await dialog(page).getByRole('button',{name:'Save as revision 2'}).click();await expect(dialog(page).getByRole('alert')).toBeVisible()
 await dialog(page).getByRole('button',{name:'Save as revision 2'}).click();await expect(dialog(page).getByText('Explore the community with our team.',{exact:true})).toBeVisible()
 const revisions=await fixture.db.from('social_content_revisions').select('*').eq('package_id',seed.packageId).order('revision_number');expect(revisions.data).toHaveLength(2);expect(revisions.data![0].approval_status).toBe('superseded');expect(revisions.data![1].approval_status).toBe('pending')
 const variant=await fixture.db.from('social_content_variants').select('link_url').eq('revision_id',revisions.data![1].id).single();expect(variant.data?.link_url).toBe('https://example.invalid/community')
 await dialog(page).getByPlaceholder('Required rationale: why approved or what must change').fill('Reviewed the exact copy and source')
 let lostApproval=true
 await page.route('**/api/forgestudio/revisions/*/approval',async route=>{if(lostApproval){lostApproval=false;const saved=await route.fetch();expect(saved.ok()).toBe(true);await route.abort('connectionreset')}else await route.continue()})
 await dialog(page).getByRole('button',{name:'Approve this exact revision'}).click();await expect(dialog(page).getByRole('alert')).toBeVisible();await dialog(page).getByRole('button',{name:'Approve this exact revision'}).click();await expect(dialog(page).getByText('approved',{exact:true})).toBeVisible()
 expect((await fixture.db.from('shared_action_events').select('action').eq('property_id',fixture.property).in('action',['studio.revision.saved','studio.revision.reviewed'])).data).toHaveLength(2)
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('forgestudio-reviewed-mobile.png'),fullPage:true})
})
test('a stale loaded revision cannot replace another operator edit',async({page,fixture})=>{
 const seed=await seeded(fixture);await openCampaign(page,fixture)
 await dialog(page).getByRole('button',{name:'Edit facebook caption'}).click();await dialog(page).getByRole('textbox',{name:'facebook caption',exact:true}).fill('Older unsaved text');await dialog(page).getByLabel('Reason for this revision').fill('Older edit rationale')
 const newId=randomUUID();expect((await rpc(fixture,'save_forgestudio_revision',{p_id:newId,p_property_id:fixture.property,p_actor_id:fixture.actor,p_payload:{packageId:seed.packageId,expectedRevisionId:seed.id,authorKind:'user',reason:'Separate accepted edit',content:{...seed.content,variants:[{...seed.content.variants[0],caption:'Current saved copy'}]},validation:[[]]}})).state).toBe('saved')
 await dialog(page).getByRole('button',{name:'Save as revision 2'}).click();await expect(dialog(page).getByRole('alert').filter({hasText:'The revision changed after you opened it.'})).toHaveText('The revision changed after you opened it. Reload and review the current version.')
 await dialog(page).getByRole('button',{name:'Reload saved revision'}).click();await expect(dialog(page).getByText('Current saved copy',{exact:true})).toBeVisible();expect((await fixture.db.from('social_content_revisions').select('id').eq('package_id',seed.packageId)).data).toHaveLength(2)
})
test('campaign loading errors remain explicit and recover without an empty-success screen',async({page,fixture})=>{
 await seeded(fixture);await page.addInitScript(p=>localStorage.setItem('p11_selected_property_id',p),fixture.property)
 await page.route('**/api/forgestudio/packages?**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Saved campaigns temporarily unavailable'})}))
 await page.goto('/dashboard/forgestudio?tab=campaigns');await expect(page.getByRole('alert').filter({hasText:'Saved campaigns temporarily unavailable'})).toBeVisible();await expect(page.getByText('No campaigns yet',{exact:false})).toHaveCount(0)
 await page.unroute('**/api/forgestudio/packages?**');await page.getByRole('button',{name:'Reload saved campaigns'}).click();await expect(page.getByRole('button').filter({hasText:'Saved editorial campaign'})).toBeVisible()
})
