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
  await check(db.from('properties').insert({ id: property, org_id: '22222222-2222-2222-2222-222222222222', name: 'ForgeStudio source browser fixture', property_type: 'multifamily' }))
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
 const values=await rpc(f,'read_forgestudio_source_record',{p_property_id:f.property,p_kind:'property',p_id:f.property})
 const bundle={version:'forgestudio.context.v1',propertyId:f.property,assembledAt:new Date().toISOString(),contextHash:'fixture-source',sourceRecords:{property:{kind:'property',id:f.property,values}},sources:[{id:'property_field:name',recordKey:'property',kind:'property_field',label:'Property name',content:values.name,authority:'authoritative',sensitivity:'public',allowedUses:['claim']}],assets:[],warnings:[],policy:{legalConfigId:null,fairHousingRequired:true,sensitiveClaimsRequireApproval:true}}
 const context=await f.db.from('shared_context_snapshots').insert({org_id:'22222222-2222-2222-2222-222222222222',property_id:f.property,source_domain:'forgestudio.generation',context_payload:bundle,context_hash:'fixture-source'}).select('id').single();if(context.error)throw context.error
 const content={contractVersion:'forgestudio.social.v1',conceptSummary:'Source review journey',variants:[{variantKey:'primary',sequenceIndex:0,platform:'facebook',caption:values.name,hashtags:[],assetIds:[],mediaUrls:[],contentFormat:'text'}],claims:[{text:values.name,type:'general',citations:[{sourceId:'property_field:name',sourceType:'property_field'}]}]}
 const result=await rpc(f,'save_forgestudio_revision',{p_id:randomUUID(),p_property_id:f.property,p_actor_id:f.actor,p_payload:{content,authorKind:'user',validation:[[]],contextSnapshotId:context.data.id}});expect(result.state).toBe('saved');return result
}
const review=(page:import('@playwright/test').Page)=>page.getByRole('region',{name:'Source review'})
async function openCampaign(page:import('@playwright/test').Page,f:Fixture){await page.addInitScript(p=>localStorage.setItem('p11_selected_property_id',p),f.property);await page.route('**/api/forgestudio/briefs/*/generate',()=>{throw new Error('Source review must never start a model')});await page.goto('/dashboard/forgestudio?tab=campaigns');await page.getByRole('button').filter({hasText:'Source review journey'}).click();await expect(review(page)).toBeVisible()}
test('changed evidence is corrected and refreshed once after a lost save response',async({page,fixture},info)=>{
 const seed=await seeded(fixture);expect((await fixture.db.from('properties').update({name:'Updated community name'}).eq('id',fixture.property)).error).toBeNull();await openCampaign(page,fixture)
 await expect(review(page).getByText('Evidence needs review',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Approve this exact revision'})).toBeDisabled()
 await review(page).getByText('Compare saved and current evidence',{exact:true}).click();await expect(review(page).getByText('Updated community name',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Edit facebook caption'}).click();await page.getByLabel('facebook caption',{exact:true}).fill('Updated community name')
 await review(page).getByText('Correct claims and refresh evidence',{exact:true}).click();await review(page).getByLabel('Claim 1 wording').fill('Updated community name');await review(page).getByLabel('Reason for refreshing sources').fill('Reviewed the changed property name and corrected the public wording')
 let lost=true;await page.route('**/api/forgestudio/packages/*/sources',async route=>{if(route.request().method()==='POST'&&lost){lost=false;const response=await route.fetch();expect(response.status()).toBe(201);await route.abort('connectionreset')}else await route.continue()})
 await review(page).getByRole('button',{name:'Save refreshed revision'}).click();await expect(review(page).getByRole('alert')).toBeVisible();await review(page).getByRole('button',{name:'Save refreshed revision'}).click()
 await expect(page.getByText('Revision 2 ·',{exact:false})).toBeVisible();await expect(review(page).getByText('The referenced records still match',{exact:false})).toBeVisible()
 await page.getByPlaceholder('Required rationale: why approved or what must change').fill('Checked the new wording against the refreshed property record');await page.getByRole('button',{name:'Approve this exact revision'}).click();await expect(page.getByText('approved',{exact:true})).toBeVisible()
 expect((await fixture.db.from('social_content_revisions').select('id').eq('package_id',seed.packageId)).data).toHaveLength(2);expect((await fixture.db.from('shared_action_events').select('id').eq('property_id',fixture.property).eq('action','studio.sources.refreshed')).data).toHaveLength(1)
 await page.setViewportSize({width:390,height:844});await review(page).getByText('Compare saved and current evidence',{exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await review(page).screenshot({path:info.outputPath('forgestudio-sources-mobile.png')})
})
test('changed preview requires a fresh look and failed reads stay visible',async({page,fixture})=>{
 await seeded(fixture);await openCampaign(page,fixture);await expect(review(page).getByText('The referenced records still match',{exact:false})).toBeVisible()
 await review(page).getByText('Correct claims and refresh evidence',{exact:true}).click();await review(page).getByLabel('Reason for refreshing sources').fill('Review the latest property evidence')
 expect((await fixture.db.from('properties').update({name:'Changed after preview'}).eq('id',fixture.property)).error).toBeNull();await review(page).getByRole('button',{name:'Save refreshed revision'}).click();await expect(review(page).getByRole('alert')).toHaveText('The sources changed after this preview. Reload sources and review the latest values.')
 expect((await fixture.db.from('social_content_revisions').select('id').eq('property_id',fixture.property)).data).toHaveLength(1)
 await page.route('**/api/forgestudio/packages/*/sources',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Saved source records unavailable'})}));await review(page).getByRole('button',{name:'Reload sources'}).click();await expect(review(page).getByRole('alert')).toHaveText('Saved source records unavailable');await expect(page.getByRole('button',{name:'Approve this exact revision'})).toBeDisabled()
 await page.unroute('**/api/forgestudio/packages/*/sources');await review(page).getByRole('button',{name:'Reload sources'}).click();await expect(review(page).getByText('Evidence needs review',{exact:false})).toBeVisible()
})

test('an archived image stays in history while its approved replacement is explicitly selected for a new revision',async({page,fixture})=>{
 const oldId=randomUUID(),replacementId=randomUUID(),contextId=randomUUID()
 const image={property_id:fixture.property,asset_type:'image',approval_status:'approved',rights_status:'owned',curation_status:'approved'}
 expect((await fixture.db.from('content_assets').insert({...image,id:oldId,name:'Original campaign photo',file_url:'https://example.invalid/original.jpg'})).error).toBeNull()
 const values=await rpc(fixture,'read_forgestudio_source_record',{p_property_id:fixture.property,p_kind:'asset',p_id:oldId})
 const bundle={propertyId:fixture.property,contextHash:'asset-evidence',sourceRecords:{['asset:'+oldId]:{kind:'asset',id:oldId,values}},sources:[{id:'asset:'+oldId,recordKey:'asset:'+oldId,kind:'asset',label:'Original campaign photo',content:'Original photo',allowedUses:['claim','format']}],assets:[{id:oldId,name:'Original campaign photo',assetType:'image',fileUrl:'https://example.invalid/original.jpg'}]}
 expect((await fixture.db.from('shared_context_snapshots').insert({id:contextId,property_id:fixture.property,org_id:'22222222-2222-2222-2222-222222222222',source_domain:'forgestudio.generation',context_hash:'asset-evidence',context_payload:bundle})).error).toBeNull()
 const revisionId=randomUUID(),content={contractVersion:'forgestudio.social.v1',conceptSummary:'Source review journey',variants:[{variantKey:'primary',sequenceIndex:0,platform:'facebook',caption:'Explore the community.',hashtags:[],assetIds:[oldId],mediaUrls:['https://example.invalid/original.jpg'],contentFormat:'image'}],claims:[]}
 const saved=await rpc(fixture,'save_forgestudio_revision',{p_id:revisionId,p_property_id:fixture.property,p_actor_id:fixture.actor,p_payload:{content,authorKind:'user',validation:[[]],contextSnapshotId:contextId}});expect(saved.state).toBe('saved')
 expect((await rpc(fixture,'review_forgestudio_revision',{p_id:randomUUID(),p_property_id:fixture.property,p_actor_id:fixture.actor,p_payload:{revisionId,contentHash:saved.revision.content_hash,decision:'approved',note:'Reviewed original caption and photo'}})).state).toBe('saved')
 expect((await fixture.db.from('content_assets').insert({...image,id:replacementId,name:'Approved replacement photo',file_url:'https://example.invalid/replacement.jpg'})).error).toBeNull()
 expect((await fixture.db.from('content_assets').update({replacement_asset_id:replacementId,archived_at:new Date().toISOString(),archived_by:fixture.actor,archive_reason:'Replaced with an approved new image',approval_status:'rejected'}).eq('id',oldId)).error).toBeNull()
 await page.route('https://example.invalid/**',route=>route.abort());await openCampaign(page,fixture);await expect(review(page).getByText('Evidence needs review',{exact:false})).toBeVisible();await review(page).getByText('Correct claims and refresh evidence',{exact:true}).click();await review(page).getByLabel('facebook replacement file').selectOption(replacementId);await review(page).getByLabel('Reason for refreshing sources').fill('Reviewed the replacement image and selected its new file for this revision');await review(page).getByRole('button',{name:'Save refreshed revision'}).click();await expect(page.getByText('Revision 2 ·',{exact:false})).toBeVisible();await expect(review(page).getByText('The referenced records still match',{exact:false})).toBeVisible()
 const variants=(await fixture.db.from('social_content_variants').select('revision_id,asset_ids,media_urls').eq('property_id',fixture.property)).data!;expect(variants).toHaveLength(2);expect(variants.find(v=>v.revision_id===revisionId)?.media_urls).toEqual(['https://example.invalid/original.jpg']);expect(variants.find(v=>v.revision_id!==revisionId)?.asset_ids).toEqual([replacementId]);expect(variants.find(v=>v.revision_id!==revisionId)?.media_urls).toEqual(['https://example.invalid/replacement.jpg'])
 expect((await fixture.db.from('content_assets').select('file_url').eq('id',oldId).single()).data?.file_url).toBe('https://example.invalid/original.jpg')
})
