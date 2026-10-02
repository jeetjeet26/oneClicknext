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
  await check(db.from('properties').insert({ id: property, org_id: '22222222-2222-2222-2222-222222222222', name: 'CRM qualification browser fixture', property_type: 'multifamily' }))
  await check(db.from('leads').insert([{id:lead,property_id:property,first_name:'CRM One',email:'leadpulse-one@fixture.invalid',source:'referral'},{id:second,property_id:property,first_name:'CRM Two',source:'website form'}]))
  await provide({ property, lead, second, actor: actor.data.id, db })
 } finally {
  execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; CREATE TEMP TABLE crm_fixture_jobs ON COMMIT DROP AS SELECT id FROM public.shared_jobs WHERE property_id='${property}'; CREATE TEMP TABLE crm_fixture_leads ON COMMIT DROP AS SELECT id FROM public.leads WHERE property_id='${property}'; UPDATE public.leads SET property_id=NULL WHERE property_id='${property}'; DELETE FROM public.properties WHERE id='${property}'; DELETE FROM public.shared_jobs WHERE id IN (SELECT id FROM crm_fixture_jobs); DELETE FROM public.leads WHERE id IN (SELECT id FROM crm_fixture_leads); COMMIT;`,stdio:['pipe','pipe','pipe']})
  expect((await db.from('properties').select('id').eq('id', property)).data).toHaveLength(0)
 }
} })
test.beforeEach(async ({page}) => { await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/) })


async function rpc(f:Fixture,name:string,args:Record<string,unknown>){const r=await f.db.rpc(name,args);if(r.error)throw r.error;return r.data}

async function openProperty(page:import('@playwright/test').Page,property:string){await page.addInitScript(p=>localStorage.setItem('p11_selected_property_id',p),property);await page.goto('/dashboard/settings/crm');await expect(page.getByRole('heading',{name:'Connection and field mapping'})).toBeVisible()}
async function fillSetup(page:import('@playwright/test').Page){await page.getByLabel('CRM provider',{exact:true}).selectOption('hubspot');await page.getByLabel('API key or access token').fill('crm-browser-private-key');await page.getByLabel('Email CRM field',{exact:true}).fill('email');await page.getByLabel('First name CRM field',{exact:true}).fill('firstname');await expect(page.getByLabel('Email CRM field',{exact:true})).toHaveValue('email');await expect(page.getByLabel('First name CRM field',{exact:true})).toHaveValue('firstname')}
async function savedSetup(page:import('@playwright/test').Page,fixture:Fixture){await openProperty(page,fixture.property);await fillSetup(page);await page.getByRole('button',{name:'Save mapping for review'}).click();await expect(page.getByText('Mapping saved for review.',{exact:true})).toBeVisible();await expect(page.getByLabel('Email CRM field',{exact:true})).toHaveValue('email')}


const panel=(page:import('@playwright/test').Page)=>page.getByRole('region',{name:'CRM provider qualification'})
async function reviewedSetup(page:import('@playwright/test').Page,f:Fixture){
 await savedSetup(page,f)
 const c=await f.db.from('integration_credentials').select('*').eq('property_id',f.property).single();if(c.error)throw c.error
 const preview=randomUUID();await rpc(f,'preview_crm_mapping',{p_property_id:f.property,p_actor_id:f.actor,p_request_id:preview,p_integration_id:c.data.id,p_revision:c.data.crm_revision});await rpc(f,'approve_crm_mapping',{p_property_id:f.property,p_actor_id:f.actor,p_request_id:randomUUID(),p_preview_id:preview});await page.reload();return c.data
}
async function claimed(f:Fixture){
 const c=await f.db.from('integration_credentials').select('*').eq('property_id',f.property).single();if(c.error)throw c.error
 const id=randomUUID();expect((await rpc(f,'prepare_crm_qualification',{p_property_id:f.property,p_actor_id:f.actor,p_request_id:id,p_integration_id:c.data.id,p_revision:c.data.crm_revision})).state).toBe('saved')
 const operation=await f.db.from('crm_qualifications').select('*').eq('id',id).single();if(operation.error)throw operation.error
 expect((await rpc(f,'command_crm_qualification',{p_property_id:f.property,p_actor_id:f.actor,p_request_id:randomUUID(),p_operation_id:id,p_kind:'run',p_payload_hash:operation.data.payload_hash})).state).toBe('applied')
 const claim=await rpc(f,'claim_crm_qualification',{p_operation_id:id});expect(claim.state).toBe('claimed');return{id,claim:claim.claimId,hash:operation.data.payload_hash}
}
async function checkpoint(f:Fixture,op:{id:string;claim:string},stage:string,result:Record<string,unknown>){return rpc(f,'checkpoint_crm_qualification',{p_operation_id:op.id,p_claim_id:op.claim,p_stage:stage,p_result:result})}
test('preparation survives a lost response, keeps exact values and stops without provider calls',async({page,fixture},info)=>{
 await reviewedSetup(page,fixture);let lost=true
 await page.route('**/api/crm/qualification',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON()?.action==='prepare'&&lost){lost=false;const response=await route.fetch();expect(response.ok()).toBe(true);await route.abort('connectionreset')}else await route.continue()})
 await panel(page).getByRole('button',{name:'Prepare provider test for review'}).click();await expect(panel(page).getByRole('alert')).toBeVisible();await page.reload()
 await expect(panel(page).getByRole('heading',{name:'Saved test · Review required'})).toHaveCount(1);await expect(panel(page).getByRole('button',{name:'Approve and run this provider test'})).toBeDisabled()
 const rows=await fixture.db.from('crm_qualifications').select('*').eq('property_id',fixture.property);expect(rows.data).toHaveLength(1);expect(rows.data![0].payload.email).toContain('@example.invalid');expect((await fixture.db.from('crm_qualification_receipts').select('id').eq('property_id',fixture.property)).data).toHaveLength(0)
 await panel(page).getByRole('button',{name:'Stop provider test'}).click();await expect(panel(page).getByRole('heading',{name:'Stopped before creating a test record'})).toBeVisible()
 await page.setViewportSize({width:390,height:844});await panel(page).scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('crm-qualification-mobile.png'),fullPage:true})
})
test('verified saved evidence displays cleanup but cannot activate delivery while paused',async({page,fixture},info)=>{
 await reviewedSetup(page,fixture);const op=await claimed(fixture)
 for(const [stage,result] of Object.entries({preflight:{identity:{id:'simulated-local-account',type:'simulated'},contractVersion:'crm-exact-v1'},create_intent:{},created:{externalId:'simulated-record',confirmed:true},readback:{externalId:'simulated-record',matches:true},search:{externalId:'simulated-record',matches:true},cleanup_intent:{externalId:'simulated-record'},cleanup:{externalId:'simulated-record',absent:true}}))await checkpoint(fixture,op,stage,result)
 expect((await rpc(fixture,'finish_crm_qualification',{p_operation_id:op.id,p_claim_id:op.claim})).qualificationState).toBe('verified')
 await panel(page).getByRole('button',{name:'Reload saved provider tests'}).click();await expect(panel(page).getByRole('heading',{name:'Lead delivery verified · Cleanup confirmed'})).toBeVisible();await expect(panel(page).getByText('Test record confirmed absent',{exact:true})).toBeVisible();await expect(panel(page).getByRole('button',{name:'Activate verified lead delivery'})).toBeDisabled()
 const blocked=await page.request.post('/api/crm/qualification',{data:{action:'activate',propertyId:fixture.property,requestId:randomUUID(),operationId:op.id,payloadHash:op.hash}});expect(blocked.status()).toBe(423)
 expect((await fixture.db.from('integration_credentials').select('mapping_validated').eq('property_id',fixture.property).single()).data?.mapping_validated).toBe(false)
 await page.screenshot({path:info.outputPath('crm-qualification-evidence.png'),fullPage:true})
})
test('uncertain creation remains visible and cannot be erased by stopping or replacing credentials',async({page,fixture})=>{
 const c=await reviewedSetup(page,fixture);const op=await claimed(fixture)
 await checkpoint(fixture,op,'preflight',{identity:{id:'simulated-local-account',type:'simulated'},contractVersion:'crm-exact-v1'});await checkpoint(fixture,op,'create_intent',{});await checkpoint(fixture,op,'failure',{reason:'create_acknowledgement_unconfirmed'})
 expect((await rpc(fixture,'finish_crm_qualification',{p_operation_id:op.id,p_claim_id:op.claim})).qualificationState).toBe('needs_reconciliation')
 await page.reload();await expect(panel(page).getByRole('heading',{name:'Test record needs recovery'})).toBeVisible();await expect(panel(page).getByText('The provider did not confirm creation. Recover the original test; do not create another.',{exact:true})).toBeVisible();await expect(panel(page).getByRole('button',{name:'Stop provider test'})).toHaveCount(0);await expect(panel(page).getByRole('button',{name:'Recover saved provider test'})).toBeEnabled()
 expect((await rpc(fixture,'command_crm_qualification',{p_property_id:fixture.property,p_actor_id:fixture.actor,p_request_id:randomUUID(),p_operation_id:op.id,p_kind:'stop',p_payload_hash:op.hash})).state).toBe('cleanup_required')
 const blocked=await fixture.db.from('integration_credentials').update({credentials:{api_key:'new-local-fixture'}}).eq('id',c.id);expect(blocked.error).toBeTruthy()
})

test('overview excludes older status flags and shows read failures instead of stale success',async({page,fixture},info)=>{
 await reviewedSetup(page,fixture)
 const updated=await fixture.db.from('leads').update({external_crm_id:'legacy-unverified',crm_sync_status:'created'}).eq('id',fixture.lead);if(updated.error)throw updated.error
 const view=page.getByRole('region',{name:'CRM delivery overview'});await view.getByRole('button',{name:'Reload delivery overview'}).click();await expect(view.getByText('New records confirmed: 0',{exact:true})).toBeVisible();await expect(view.getByText('1 older lead records have CRM status',{exact:false})).toBeVisible()
 await page.route('**/api/crm/monitor?**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Saved status temporarily unavailable'})}));await view.getByRole('button',{name:'Reload delivery overview'}).click();await expect(view.getByRole('alert')).toHaveText('Saved status temporarily unavailable');await expect(view.getByText('New records confirmed: 0',{exact:true})).toHaveCount(0)
 await page.unroute('**/api/crm/monitor?**');await view.getByRole('button',{name:'Reload delivery overview'}).click();await expect(view.getByText('New records confirmed: 0',{exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('crm-overview.png'),fullPage:true})
})
