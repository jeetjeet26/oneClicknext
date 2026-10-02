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
  await check(db.from('properties').insert({ id: property, org_id: '22222222-2222-2222-2222-222222222222', name: 'ForgeStudio publication browser fixture', property_type: 'multifamily' }))
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
async function approved(f:Fixture){
 const seed=await seeded(f);const revision=await f.db.from('social_content_revisions').select('content_hash').eq('id',seed.id).single();if(revision.error)throw revision.error
 expect((await rpc(f,'review_forgestudio_revision',{p_id:randomUUID(),p_property_id:f.property,p_actor_id:f.actor,p_payload:{revisionId:seed.id,contentHash:revision.data.content_hash,decision:'approved',note:'Reviewed exact campaign for publication'}})).state).toBe('saved')
 const connection=randomUUID();const result=await f.db.from('social_connections').insert({id:connection,property_id:f.property,platform:'facebook',account_id:'isolated-fixture-account',account_name:'Fixture destination',is_active:true,access_token:'encv1:fixture',page_access_token:'encv1:page',page_id:'isolated-fixture-account',scopes:['pages_show_list','pages_read_engagement','pages_manage_posts'],token_expires_at:new Date(Date.now()+60*86400_000).toISOString(),permission_evidence:{source:'provider_response',expiryKnown:true}});if(result.error)throw result.error
 const variant=await f.db.from('social_content_variants').select('id').eq('revision_id',seed.id).single();if(variant.error)throw variant.error
 return{...seed,connection,variant:variant.data.id,hash:revision.data.content_hash}
}
async function scheduled(f:Fixture){const seed=await approved(f);const result=await rpc(f,'schedule_forgestudio_publications',{p_id:randomUUID(),p_property_id:f.property,p_actor_id:f.actor,p_payload:{revisionId:seed.id,contentHash:seed.hash,destinations:[{connectionId:seed.connection,variantId:seed.variant,scheduledFor:new Date(Date.now()+86400000).toISOString(),timezone:'America/Los_Angeles'}]}});expect(result.state).toBe('saved');return result.publications[0]}
async function calendar(page:import('@playwright/test').Page,f:Fixture){await page.addInitScript(p=>localStorage.setItem('p11_selected_property_id',p),f.property);await page.goto('/dashboard/forgestudio?tab=schedule');await expect(page.getByText('Publication schedule',{exact:true})).toBeVisible()}
function localTime(days:number){const d=new Date(Date.now()+days*86400000);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16)}
test('lost schedule and cancellation replies recover one saved decision',async({page,fixture})=>{
 await approved(fixture);await openCampaign(page,fixture)
 await dialog(page).getByRole('button',{name:'text #1',exact:true}).click();await dialog(page).getByLabel('Publication schedule time').fill(localTime(2))
 let lost=true;await page.route('**/api/forgestudio/publications',async route=>{if(route.request().method()==='POST'&&lost){lost=false;const response=await route.fetch();expect(response.status()).toBe(201);await route.abort('connectionreset')}else await route.continue()})
 await dialog(page).getByRole('button',{name:'Schedule',exact:true}).click();await expect(dialog(page).getByRole('alert')).toBeVisible();await dialog(page).getByRole('button',{name:'Schedule',exact:true}).click();await expect(dialog(page).getByText('scheduled',{exact:true})).toBeVisible()
 const publications=await fixture.db.from('social_publications').select('*').eq('property_id',fixture.property);expect(publications.data).toHaveLength(1)
 await calendar(page,fixture);let cancelLost=true;await page.route('**/api/forgestudio/publications/*',async route=>{if(route.request().method()==='PATCH'&&cancelLost){cancelLost=false;const saved=await route.fetch();expect(saved.status()).toBe(200);await route.abort('connectionreset')}else await route.continue()});page.on('dialog',d=>d.accept())
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByText('Failed to fetch',{exact:false})).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByText('Cancelled',{exact:true})).toBeVisible()
 expect((await fixture.db.from('shared_action_events').select('action').eq('property_id',fixture.property).in('action',['studio.publications.scheduled','studio.publication.cancel'])).data).toHaveLength(2)
})
test('calendar rejects a stale schedule and reloads the actual saved time',async({page,fixture})=>{
 const publication=await scheduled(fixture);await calendar(page,fixture);await page.getByRole('button',{name:'Reschedule',exact:true}).click();await page.getByLabel('New publication time').fill(localTime(3))
 expect((await rpc(fixture,'control_forgestudio_publication',{p_id:randomUUID(),p_property_id:fixture.property,p_actor_id:fixture.actor,p_payload:{publicationId:publication.id,expectedUpdatedAt:publication.updated_at,action:'reschedule',scheduledFor:new Date(Date.now()+4*86400000).toISOString()}})).state).toBe('saved')
 await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByText('The saved publication changed. Reload its current state before changing it.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Refresh publication schedule',exact:true}).click();await expect(page.getByRole('button',{name:'Reschedule',exact:true})).toBeVisible()
})
test('an uncertain provider write can be reviewed without a duplicate post and labels manual evidence',async({page,fixture},info)=>{
 const publication=await scheduled(fixture),claim=randomUUID();const updated=await fixture.db.from('shared_jobs').update({lifecycle_status:'running',lease_owner:'fixture-worker',lease_expires_at:new Date(Date.now()+60000).toISOString(),attempt_count:1}).eq('id',publication.shared_job_id);if(updated.error)throw updated.error
 const args={p_job_id:publication.shared_job_id,p_worker:'fixture-worker',p_claim_id:claim};const prepared=await rpc(fixture,'prepare_forgestudio_publication_write',args);expect(prepared.state).toBe('prepared');expect((await rpc(fixture,'prepare_forgestudio_publication_write',{...args,p_fingerprint:prepared.fingerprint})).state).toBe('proceed_once');expect((await rpc(fixture,'finish_forgestudio_publication_write',{...args,p_payload:{kind:'provider_uncertain',reason:'Isolated simulated timeout; no provider was contacted'}})).state).toBe('saved')
 await calendar(page,fixture);await page.getByRole('button',{name:'Review saved evidence'}).click();const panel=page.getByRole('region',{name:'Publication evidence and recovery'});await expect(panel.getByText('Provider result is uncertain',{exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'Resume only if no write occurred'})).toHaveCount(0)
 await panel.getByLabel('Publication recovery evidence').fill('Checked the isolated destination record and exact reviewed content');await panel.getByLabel('Existing provider post ID').fill('fixture-existing');await panel.getByLabel('Existing post URL').fill('https://example.invalid/fixture-existing')
 let lost=true;await page.route('**/api/forgestudio/publications/*/recovery',async route=>{if(lost){lost=false;const saved=await route.fetch();expect(saved.status()).toBe(200);await route.abort('connectionreset')}else await route.continue()})
 await panel.getByRole('button',{name:'Record the existing post'}).click();await expect(panel.getByRole('alert')).toBeVisible();await panel.getByRole('button',{name:'Record the existing post'}).click();await expect(page.getByText('Published',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Review saved evidence'}).click();await expect(panel.getByText('Existing post recorded by a manager',{exact:true})).toBeVisible()
 const receipts=await fixture.db.from('forgestudio_publication_receipts').select('kind').eq('publication_id',publication.id);expect(receipts.data?.map(x=>x.kind).sort()).toEqual(['operator_attestation','provider_uncertain','write_intent'].sort());expect((await fixture.db.from('shared_jobs').select('lifecycle_status').eq('id',publication.shared_job_id).single()).data?.lifecycle_status).toBe('succeeded')
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await panel.scrollIntoViewIfNeeded();await panel.screenshot({path:info.outputPath('forgestudio-publication-evidence-mobile.png')})
})
