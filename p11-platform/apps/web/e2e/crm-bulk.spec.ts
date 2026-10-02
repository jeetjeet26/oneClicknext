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
  await check(db.from('properties').insert({ id: property, org_id: '22222222-2222-2222-2222-222222222222', name: 'CRM delivery browser fixture', property_type: 'multifamily' }))
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
async function fillSetup(page:import('@playwright/test').Page){await page.getByLabel('API key or access token').fill('crm-browser-private-key');await page.getByLabel('Email CRM field',{exact:true}).fill('email');await page.getByLabel('First name CRM field',{exact:true}).fill('first_name');await expect(page.getByLabel('Email CRM field',{exact:true})).toHaveValue('email');await expect(page.getByLabel('First name CRM field',{exact:true})).toHaveValue('first_name')}
async function savedSetup(page:import('@playwright/test').Page,fixture:Fixture){await openProperty(page,fixture.property);await fillSetup(page);await page.getByRole('button',{name:'Save mapping for review'}).click();await expect(page.getByText('Mapping saved for review.',{exact:true})).toBeVisible();await expect(page.getByLabel('Email CRM field',{exact:true})).toHaveValue('email')}

async function qualifyFixture(f:Fixture){
 const connection=await f.db.from('integration_credentials').select('*').eq('property_id',f.property).single();if(connection.error)throw connection.error
 const c=connection.data,preview=randomUUID(),approval=randomUUID(),receipt=randomUUID()
 await rpc(f,'preview_crm_mapping',{p_property_id:f.property,p_actor_id:f.actor,p_request_id:preview,p_integration_id:c.id,p_revision:c.crm_revision})
 await rpc(f,'approve_crm_mapping',{p_property_id:f.property,p_actor_id:f.actor,p_request_id:approval,p_preview_id:preview})
 const credentialsHash=await rpc(f,'crm_configuration_hash',{p_value:c.credentials}),mappingHash=await rpc(f,'crm_configuration_hash',{p_value:c.field_mapping})
 const proof=await f.db.from('crm_validation_receipts').insert({id:receipt,property_id:f.property,integration_id:c.id,revision:c.crm_revision,credentials_hash:credentialsHash,mapping_hash:mappingHash,provider_identity:{fixture:true},capabilities:{fixture:true,leadSearch:true,leadRead:true,leadWrite:true,noteWrite:true},evidence:{simulated:true},state:'verified'});if(proof.error)throw proof.error
 const qualified=await f.db.from('integration_credentials').update({crm_validation_receipt_id:receipt,mapping_validated:true,status:'connected'}).eq('id',c.id);if(qualified.error)throw qualified.error
 return c
}
async function prepareFixture(f:Fixture,key:string,note?:string){const prepared=await rpc(f,'request_crm_handoff',{p_property_id:f.property,p_lead_id:f.lead,p_request_key:key,p_origin:'operator',p_actor_id:f.actor,p_note:note||null});expect(prepared.state).toBe('queued');const id=prepared.handoffId,preview=await rpc(f,'preview_crm_handoff',{p_property_id:f.property,p_actor_id:f.actor,p_handoff_id:id});await rpc(f,'approve_crm_handoff',{p_property_id:f.property,p_actor_id:f.actor,p_handoff_id:id,p_request_id:randomUUID(),p_payload_hash:preview.payloadHash});const claim=await rpc(f,'claim_crm_handoff',{p_handoff_id:id});expect(claim.state).toBe('claimed');return{id,claim:claim.claimId}}
const bulkPanel=(page:import('@playwright/test').Page)=>page.getByRole('region',{name:'Bulk CRM transfers'})
test('saved selection survives a lost reply and reload, preserves exclusions and stops only its own transfers',async({page,fixture},info)=>{
 await savedSetup(page,fixture);await qualifyFixture(fixture)
 const panel=bulkPanel(page)
 await panel.getByRole('checkbox',{name:'Select CRM One',exact:true}).check();await panel.getByRole('checkbox',{name:'Select CRM Two',exact:true}).check()
 let lost=true
 await page.route('**/api/crm/batches',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON()?.action==='prepare'&&lost){lost=false;const response=await route.fetch();expect(response.ok()).toBe(true);await route.abort('connectionreset')}else await route.continue()})
 await panel.getByRole('button',{name:'Save batch for review'}).click();await expect(panel.getByRole('alert')).toBeVisible()
 await page.reload();await expect(panel.getByRole('button',{name:'Review saved batch'})).toHaveCount(1);await panel.getByRole('button',{name:'Review saved batch'}).click()
 await expect(panel.getByRole('heading',{name:'Saved batch review'})).toBeVisible();await expect(panel.getByText('Missing email or phone · excluded',{exact:true})).toBeVisible();await expect(panel.getByRole('definition').filter({hasText:'leadpulse-one@fixture.invalid'})).toBeVisible();await expect(panel.getByRole('button',{name:'Approve 1 saved transfers'})).toBeDisabled()
 const rows=await fixture.db.from('crm_bulk_batches').select('*').eq('property_id',fixture.property);expect(rows.data).toHaveLength(1);expect((await fixture.db.from('crm_handoff_approvals').select('id').eq('property_id',fixture.property)).data).toHaveLength(0)
 const extra=randomUUID();const inserted=await fixture.db.from('leads').insert({id:extra,property_id:fixture.property,first_name:'Outside batch',email:'outside@fixture.invalid'});if(inserted.error)throw inserted.error
 const other=await rpc(fixture,'request_crm_handoff',{p_property_id:fixture.property,p_lead_id:extra,p_request_key:'outside-batch-browser',p_origin:'operator',p_actor_id:fixture.actor})
 await panel.getByRole('button',{name:'Stop remaining batch transfers'}).click();await expect(panel.getByText('Stop recorded. Confirmed and uncertain results remain in the history.',{exact:true})).toBeVisible()
 expect((await fixture.db.from('crm_handoffs').select('state').eq('id',other.handoffId).single()).data?.state).toBe('queued')
 expect((await fixture.db.from('crm_handoff_receipts').select('id').eq('property_id',fixture.property)).data).toHaveLength(0)
 await page.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('crm-bulk-review-mobile.png'),fullPage:true})
})
test('selection spans pages and literal search without silently selecting all matches',async({page,fixture})=>{
 await savedSetup(page,fixture);await qualifyFixture(fixture)
 const additions=Array.from({length:27},(_,i)=>({id:randomUUID(),property_id:fixture.property,first_name:`Page lead ${i}`,email:`page-${i}@fixture.invalid`}));const inserted=await fixture.db.from('leads').insert(additions);if(inserted.error)throw inserted.error
 await page.reload();const panel=bulkPanel(page);await expect(panel.getByText('29 matching leads · Page 1 of 2',{exact:true})).toBeVisible()
 await panel.getByRole('checkbox').first().check();await panel.getByRole('button',{name:'Next lead page'}).click();await expect(panel.getByText('29 matching leads · Page 2 of 2',{exact:true})).toBeVisible();await panel.getByRole('checkbox',{name:'Select CRM One',exact:true}).check()
 await panel.getByLabel('Find leads for batch').fill(',email.neq.null');await expect(panel.getByText('No matching leads.',{exact:true})).toBeVisible();await expect(panel.getByRole('heading',{name:'Selected leads (2/100)'})).toBeVisible()
 await panel.getByRole('button',{name:'Save batch for review'}).click();await expect(panel.getByRole('heading',{name:'Saved batch review'})).toBeVisible();const batches=await fixture.db.from('crm_bulk_batches').select('lead_ids').eq('property_id',fixture.property);expect(batches.data).toHaveLength(1);expect(batches.data![0].lead_ids).toHaveLength(2);expect((await fixture.db.from('crm_handoffs').select('id').eq('property_id',fixture.property)).data).toHaveLength(2)
})
test('saved partial results keep uncertain delivery on hold when remaining transfers are stopped',async({page,fixture},info)=>{
 await savedSetup(page,fixture);await qualifyFixture(fixture)
 const third=randomUUID();let change=await fixture.db.from('leads').update({email:'second@fixture.invalid'}).eq('id',fixture.second);if(change.error)throw change.error;change=await fixture.db.from('leads').insert({id:third,property_id:fixture.property,first_name:'CRM Three',email:'third@fixture.invalid'});if(change.error)throw change.error
 const batch=randomUUID();await rpc(fixture,'prepare_crm_bulk',{p_property_id:fixture.property,p_actor_id:fixture.actor,p_request_id:batch,p_lead_ids:[fixture.lead,fixture.second,third]})
 const saved=await rpc(fixture,'read_crm_bulk',{p_property_id:fixture.property,p_actor_id:fixture.actor,p_batch_id:batch});await rpc(fixture,'command_crm_bulk',{p_property_id:fixture.property,p_actor_id:fixture.actor,p_batch_id:batch,p_request_id:randomUUID(),p_kind:'approve',p_manifest_hash:saved.manifestHash})
 for(const [lead,outcome] of [[fixture.lead,'linked'],[fixture.second,'needs_reconciliation']]){
  const h=await fixture.db.from('crm_handoffs').select('id').eq('lead_id',lead).single();if(h.error)throw h.error;const claimed=await rpc(fixture,'claim_crm_handoff',{p_handoff_id:h.data.id})
  await rpc(fixture,'record_crm_handoff_search',{p_handoff_id:h.data.id,p_claim_id:claimed.claimId,p_found:outcome==='linked',...(outcome==='linked'?{p_external_id:'bulk-browser-record',p_match_type:'email'}:{})})
  if(outcome==='needs_reconciliation')await rpc(fixture,'mark_crm_handoff_write',{p_handoff_id:h.data.id,p_claim_id:claimed.claimId})
  await rpc(fixture,'finish_crm_handoff',{p_handoff_id:h.data.id,p_claim_id:claimed.claimId,p_outcome:outcome,...(outcome==='linked'?{p_external_id:'bulk-browser-record'}:{})})
 }
 const panel=bulkPanel(page);await panel.getByRole('button',{name:'Reload saved batches'}).click();await panel.getByRole('button',{name:'Review saved batch'}).click();await expect(panel.getByRole('listitem').filter({hasText:'Confirmed destination: 1'})).toBeVisible();await expect(panel.getByRole('listitem').filter({hasText:'Uncertain — needs destination review: 1'})).toBeVisible()
 await panel.getByRole('button',{name:'Stop remaining batch transfers'}).click();await expect(panel.getByRole('listitem').filter({hasText:'Stopped: 1'})).toBeVisible();await expect(panel.getByRole('listitem').filter({hasText:'Uncertain — needs destination review: 1'})).toBeVisible();await expect(panel.getByText('This batch will not resend it.',{exact:false})).toBeVisible()
 const after=await rpc(fixture,'read_crm_bulk',{p_property_id:fixture.property,p_actor_id:fixture.actor,p_batch_id:batch});expect(after.counts).toEqual({confirmed:1,needs_reconciliation:1,cancelled:1});await page.screenshot({path:info.outputPath('crm-bulk-partial-results.png'),fullPage:true});await panel.getByRole('article').filter({has:page.getByRole('heading',{name:'CRM Two',exact:true})}).getByRole('button',{name:'Review this transfer'}).click();await expect(page.getByRole('region',{name:'Individual CRM transfers'}).getByRole('heading',{name:'Saved lead transfer values'})).toBeVisible();await expect(page.getByRole('button',{name:'Check destination without resending'})).toBeVisible()
})
test('concurrent request and approval retries keep one immutable selection and one approval per lead',async({page,fixture})=>{
 await savedSetup(page,fixture);await qualifyFixture(fixture);const batch=randomUUID(),approval=randomUUID(),scope={p_property_id:fixture.property,p_actor_id:fixture.actor}
 const prepares=await Promise.all(Array.from({length:4},()=>rpc(fixture,'prepare_crm_bulk',{...scope,p_request_id:batch,p_lead_ids:[fixture.lead,fixture.second]})));expect(prepares.filter(p=>p.state==='saved')).toHaveLength(1);expect(prepares.filter(p=>p.state==='replayed')).toHaveLength(3)
 const saved=await rpc(fixture,'read_crm_bulk',{...scope,p_batch_id:batch});const approvals=await Promise.all(Array.from({length:4},()=>rpc(fixture,'command_crm_bulk',{...scope,p_batch_id:batch,p_request_id:approval,p_kind:'approve',p_manifest_hash:saved.manifestHash})));expect(approvals.filter(p=>p.state==='applied')).toHaveLength(1);expect(approvals.filter(p=>p.state==='replayed')).toHaveLength(3)
 expect((await fixture.db.from('crm_handoff_approvals').select('id').eq('property_id',fixture.property)).data).toHaveLength(1);expect((await fixture.db.from('crm_bulk_commands').select('id').eq('batch_id',batch)).data).toHaveLength(1)
 const panel=bulkPanel(page);await panel.getByRole('button',{name:'Reload saved batches'}).click();await panel.getByRole('button',{name:'Review saved batch'}).click();await expect(panel.getByText('Approved · Waiting for worker',{exact:true})).toBeVisible();await expect(panel.getByText('Missing email or phone · excluded',{exact:true})).toBeVisible()
})
test('changed lead details are visible on reload and cannot be approved as the old selection',async({page,fixture})=>{
 await savedSetup(page,fixture);await qualifyFixture(fixture);const panel=bulkPanel(page)
 await panel.getByRole('checkbox',{name:'Select CRM One',exact:true}).check();await panel.getByRole('button',{name:'Save batch for review'}).click();await expect(panel.getByRole('heading',{name:'Saved batch review'})).toBeVisible()
 const update=await fixture.db.from('leads').update({email:'changed@fixture.invalid'}).eq('id',fixture.lead);if(update.error)throw update.error
 await panel.getByRole('button',{name:'Reload saved batches'}).click();await expect(panel.getByText('Lead or connection changed. Stop this batch and prepare a fresh selection.',{exact:true})).toBeVisible();await expect(panel.getByRole('definition').filter({hasText:'leadpulse-one@fixture.invalid'})).toBeVisible()
 const batch=await fixture.db.from('crm_bulk_batches').select('*').eq('property_id',fixture.property).single();if(batch.error)throw batch.error
 expect((await rpc(fixture,'command_crm_bulk',{p_property_id:fixture.property,p_actor_id:fixture.actor,p_batch_id:batch.data.id,p_request_id:randomUUID(),p_kind:'approve',p_manifest_hash:batch.data.manifest_hash})).state).toBe('stale_source');expect((await fixture.db.from('crm_handoff_approvals').select('id').eq('property_id',fixture.property)).data).toHaveLength(0)
})
