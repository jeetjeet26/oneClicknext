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
test('prepares exact values without sending, and stop preserves recorded intent',async({page,fixture},info)=>{
 await savedSetup(page,fixture);await qualifyFixture(fixture);await page.getByLabel('Preview source').selectOption(fixture.lead);await page.getByRole('button',{name:'Prepare lead transfer',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Saved lead transfer values'})).toBeVisible();await expect(page.getByRole('region',{name:'Individual CRM transfers'}).getByText('leadpulse-one@fixture.invalid',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Approve these values and send'})).toBeDisabled()
 const handoffs=await fixture.db.from('crm_handoffs').select('id,job_id,state').eq('property_id',fixture.property);expect(handoffs.data).toHaveLength(1);const h=handoffs.data![0];expect(h.state).toBe('queued')
 expect((await fixture.db.from('crm_handoff_approvals').select('id').eq('handoff_id',h.id)).data).toHaveLength(0);expect((await fixture.db.from('crm_handoff_receipts').select('id').eq('handoff_id',h.id)).data).toHaveLength(0)
 await page.getByRole('button',{name:'Stop transfer',exact:true}).click();await expect(page.getByText('Transfer stopped before a provider write.',{exact:true})).toBeVisible()
 expect((await fixture.db.from('shared_jobs').select('lifecycle_status').eq('id',h.job_id).single()).data?.lifecycle_status).toBe('cancelled')
 const history=await fixture.db.from('shared_action_events').select('action,training_eligible').eq('property_id',fixture.property).like('action','crm.delivery.%');expect(history.data).toHaveLength(2);expect(history.data!.every(r=>!r.training_eligible)).toBe(true)
 await page.screenshot({path:info.outputPath('crm-transfer-stopped.png'),fullPage:true})
})
test('uncertain delivery is held against repeat transfer and credential replacement',async({page,fixture},info)=>{
 await savedSetup(page,fixture);const c=await qualifyFixture(fixture);const h=await prepareFixture(fixture,'uncertain-browser-fixture')
 await rpc(fixture,'record_crm_handoff_search',{p_handoff_id:h.id,p_claim_id:h.claim,p_found:false});await rpc(fixture,'mark_crm_handoff_write',{p_handoff_id:h.id,p_claim_id:h.claim});await rpc(fixture,'finish_crm_handoff',{p_handoff_id:h.id,p_claim_id:h.claim,p_outcome:'needs_reconciliation'})
 await page.getByRole('button',{name:'Reload saved transfers'}).click();await expect(page.getByText('Review uncertain result',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Stop transfer',exact:true})).toHaveCount(0)
 await page.getByLabel('Preview source').selectOption(fixture.lead);await page.getByRole('button',{name:'Prepare lead transfer',exact:true}).click();await expect(page.getByText('This lead already has an unfinished transfer. Review its saved state.')).toBeVisible()
 await page.getByLabel('Replace stored credentials').check();await page.getByLabel('API key or access token').fill('must-not-replace-while-uncertain');await page.getByRole('button',{name:'Save mapping for review'}).click();await expect(page.getByText('Resolve the uncertain CRM transfer before changing this connection.')).toBeVisible()
 expect((await fixture.db.from('integration_credentials').select('credentials').eq('id',c.id).single()).data?.credentials).toEqual(c.credentials)
 await page.screenshot({path:info.outputPath('crm-uncertain-transfer.png'),fullPage:true})
})
test('saved note evidence remains private and reviewable while new note delivery is unavailable',async({page,fixture},info)=>{
 await savedSetup(page,fixture);await qualifyFixture(fixture);const h=await prepareFixture(fixture,'linked-browser-fixture')
 await rpc(fixture,'record_crm_handoff_search',{p_handoff_id:h.id,p_claim_id:h.claim,p_found:true,p_external_id:'provider-browser-record',p_match_type:'email'});await rpc(fixture,'finish_crm_handoff',{p_handoff_id:h.id,p_claim_id:h.claim,p_outcome:'linked',p_external_id:'provider-browser-record'})
 // Synthetic retained note evidence; the current console offers no unqualified note-delivery control.
 const prepared=await rpc(fixture,'request_crm_handoff',{p_property_id:fixture.property,p_lead_id:fixture.lead,p_request_key:'retained-note-fixture',p_origin:'operator',p_actor_id:fixture.actor,p_note:'Private conversation summary for the CRM.'});expect(prepared.state).toBe('queued')
 await page.getByRole('button',{name:'Reload saved transfers'}).click();await expect(page.getByText('Confirmed',{exact:true})).toBeVisible();await expect(page.getByText('Note delivery is unavailable. Saved note attempts remain available for review.')).toBeVisible();await expect(page.getByLabel('Prepare a note for an already linked lead')).toHaveCount(0)
 await page.getByRole('article').filter({has:page.getByRole('heading',{name:'CRM One · Note',exact:true})}).getByRole('button',{name:'Review saved values'}).click();await expect(page.getByRole('heading',{name:'Saved note values'})).toBeVisible();await expect(page.getByRole('definition').filter({hasText:'Private conversation summary for the CRM.'})).toBeVisible();await expect(page.getByRole('button',{name:'Approve these values and send'})).toHaveCount(0)

 const notes=await fixture.db.from('crm_handoffs').select('id').eq('property_id',fixture.property).eq('kind','note');expect(notes.data).toHaveLength(1)
 const shared=await fixture.db.from('shared_action_events').select('request,result').eq('episode_id',notes.data![0].id);expect(JSON.stringify(shared.data)).not.toContain('Private conversation summary')
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('crm-note-mobile.png'),fullPage:true})
})

test('recovers a lost destination-check reply, reviews saved provider evidence, and confirms without resending',async({page,fixture},info)=>{
 await savedSetup(page,fixture);await qualifyFixture(fixture);const h=await prepareFixture(fixture,'recovery-browser-fixture')
 await rpc(fixture,'record_crm_handoff_search',{p_handoff_id:h.id,p_claim_id:h.claim,p_found:false});await rpc(fixture,'mark_crm_handoff_write',{p_handoff_id:h.id,p_claim_id:h.claim});await rpc(fixture,'finish_crm_handoff',{p_handoff_id:h.id,p_claim_id:h.claim,p_outcome:'needs_reconciliation'})
 await page.getByRole('button',{name:'Reload saved transfers'}).click();await page.getByRole('button',{name:'Review saved values',exact:true}).click();let lost=true
 await page.route('**/api/crm/deliveries',async route=>{
  const body=route.request().postDataJSON();if(body?.action!=='check_destination'){await route.continue();return}
  // Simulated provider worker only: real persisted request/claim/evidence, no provider network.
  const requested=await rpc(fixture,'request_crm_reconciliation',{p_property_id:fixture.property,p_actor_id:fixture.actor,p_handoff_id:h.id,p_request_id:body.requestId})
  const claimed=await rpc(fixture,'claim_crm_reconciliation',{p_check_id:requested.checkId})
  if(claimed.state==='claimed')await rpc(fixture,'finish_crm_reconciliation',{p_check_id:requested.checkId,p_claim_id:claimed.claimId,p_result:{status:'match',externalId:'recovered-browser-record',matchType:'email',observedContact:{email:'leadpulse-one@fixture.invalid'},originalWriteConfirmed:false}})
  if(lost){lost=false;await route.abort('connectionreset');return}
  const preview=await rpc(fixture,'preview_crm_handoff',{p_property_id:fixture.property,p_actor_id:fixture.actor,p_handoff_id:h.id});await route.fulfill({status:200,json:preview})
 })
 await page.getByRole('button',{name:'Check destination without resending'}).click();await expect(page.getByRole('alert')).toBeVisible()
 await page.getByRole('button',{name:'Reload saved transfers'}).click();await expect(page.getByText('Provider record: recovered-browser-record',{exact:true})).toBeVisible()
 let lostAcceptance=true
 await page.route('**/api/crm/deliveries',async route=>{const body=route.request().postDataJSON();if(body?.action==='accept_destination'&&lostAcceptance){lostAcceptance=false;const response=await route.fetch();expect(response.ok()).toBe(true);await route.abort('connectionreset')}else await route.fallback()})
 await page.getByRole('button',{name:'Confirm this destination link'}).click();await expect(page.getByRole('alert')).toBeVisible()
 await page.getByRole('button',{name:'Reload saved transfers'}).click();await expect(page.getByText('Destination link confirmed',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Confirm this destination link'})).toHaveCount(0)
 const receipts=await fixture.db.from('crm_handoff_receipts').select('stage,result').eq('handoff_id',h.id);expect(receipts.data?.filter(r=>r.stage==='write_intent')).toHaveLength(1);expect(receipts.data?.filter(r=>r.stage==='reconciliation')).toHaveLength(1);expect(receipts.data?.find(r=>r.stage==='result')?.result.outcome).toBe('needs_reconciliation')
 expect((await fixture.db.from('leads').select('crm_sync_status,external_crm_id').eq('id',fixture.lead).single()).data).toMatchObject({crm_sync_status:'linked',external_crm_id:'recovered-browser-record'})
 await page.getByText('Provider record: recovered-browser-record',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('crm-recovered-destination.png'),fullPage:true})
})
test('a missing destination remains on hold after a saved read',async({page,fixture})=>{
 await savedSetup(page,fixture);await qualifyFixture(fixture);const h=await prepareFixture(fixture,'no-match-browser-fixture')
 await rpc(fixture,'record_crm_handoff_search',{p_handoff_id:h.id,p_claim_id:h.claim,p_found:false});await rpc(fixture,'mark_crm_handoff_write',{p_handoff_id:h.id,p_claim_id:h.claim});await rpc(fixture,'finish_crm_handoff',{p_handoff_id:h.id,p_claim_id:h.claim,p_outcome:'needs_reconciliation'})
 const check=randomUUID();await rpc(fixture,'request_crm_reconciliation',{p_property_id:fixture.property,p_actor_id:fixture.actor,p_handoff_id:h.id,p_request_id:check});const claim=await rpc(fixture,'claim_crm_reconciliation',{p_check_id:check});await rpc(fixture,'finish_crm_reconciliation',{p_check_id:check,p_claim_id:claim.claimId,p_result:{status:'no_match'}})
 await page.getByRole('button',{name:'Reload saved transfers'}).click();await page.getByRole('button',{name:'Review saved values',exact:true}).click();await expect(page.getByText(/No matching record was confirmed/)).toBeVisible();await expect(page.getByRole('button',{name:'Confirm this destination link'})).toHaveCount(0);await expect(page.getByText('Review uncertain result',{exact:true})).toBeVisible()
})

test('simultaneous delivery workers permit one claim, one write intent and one completion',async({page,fixture})=>{
 await savedSetup(page,fixture);await qualifyFixture(fixture)
 const prepared=await rpc(fixture,'request_crm_handoff',{p_property_id:fixture.property,p_lead_id:fixture.lead,p_request_key:'concurrent-delivery-fixture',p_origin:'workflow'})
 const claims=await Promise.all(Array.from({length:4},()=>rpc(fixture,'claim_crm_handoff',{p_handoff_id:prepared.handoffId})));expect(claims.filter(r=>r.state==='claimed')).toHaveLength(1);const claim=claims.find(r=>r.state==='claimed')!
 const scope={p_handoff_id:prepared.handoffId,p_claim_id:claim.claimId}
 const searches=await Promise.all(Array.from({length:4},()=>rpc(fixture,'record_crm_handoff_search',{...scope,p_found:false})));expect(searches.filter(r=>r.state==='saved')).toHaveLength(1)
 const intents=await Promise.all(Array.from({length:4},()=>rpc(fixture,'mark_crm_handoff_write',scope)));expect(intents.filter(r=>r.state==='write_once')).toHaveLength(1)
 const completions=await Promise.all(Array.from({length:4},()=>rpc(fixture,'finish_crm_handoff',{...scope,p_outcome:'created',p_external_id:'concurrent-provider-fixture'})));expect(completions.filter(r=>r.state==='saved')).toHaveLength(1)
 const receipts=await fixture.db.from('crm_handoff_receipts').select('stage').eq('handoff_id',prepared.handoffId);expect(receipts.data).toHaveLength(3);expect((await fixture.db.from('crm_lead_links').select('external_id').eq('handoff_id',prepared.handoffId)).data).toEqual([{external_id:'concurrent-provider-fixture'}])
 await page.getByRole('button',{name:'Reload saved transfers'}).click();await expect(page.getByText('Confirmed',{exact:true})).toBeVisible()
})
