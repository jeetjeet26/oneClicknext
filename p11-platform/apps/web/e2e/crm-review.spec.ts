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
  await check(db.from('properties').insert({ id: property, org_id: '22222222-2222-2222-2222-222222222222', name: 'CRM browser fixture', property_type: 'multifamily' }))
  await check(db.from('leads').insert([{id:lead,property_id:property,first_name:'CRM One',email:'leadpulse-one@fixture.invalid',source:'referral'},{id:second,property_id:property,first_name:'CRM Two',source:'website form'}]))
  await provide({ property, lead, second, actor: actor.data.id, db })
 } finally {
  execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.leads WHERE property_id='${property}'; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
  expect((await db.from('properties').select('id').eq('id', property)).data).toHaveLength(0)
 }
} })
test.beforeEach(async ({page}) => { await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/) })


async function rpc(f:Fixture,name:string,args:Record<string,unknown>){const r=await f.db.rpc(name,args);if(r.error)throw r.error;return r.data}

async function openProperty(page:import('@playwright/test').Page,property:string){await page.addInitScript(p=>localStorage.setItem('p11_selected_property_id',p),property);await page.goto('/dashboard/settings/crm');await expect(page.getByRole('heading',{name:'Connection and field mapping'})).toBeVisible()}
async function fillSetup(page:import('@playwright/test').Page){await page.getByLabel('API key or access token').fill('crm-browser-private-key');await page.getByLabel('Email CRM field',{exact:true}).fill('email');await page.getByLabel('First name CRM field',{exact:true}).fill('first_name');await expect(page.getByLabel('Email CRM field',{exact:true})).toHaveValue('email');await expect(page.getByLabel('First name CRM field',{exact:true})).toHaveValue('first_name')}
async function savedSetup(page:import('@playwright/test').Page,fixture:Fixture){await openProperty(page,fixture.property);await fillSetup(page);await page.getByRole('button',{name:'Save mapping for review'}).click();await expect(page.getByText('Mapping saved for review.',{exact:true})).toBeVisible();await expect(page.getByLabel('Email CRM field',{exact:true})).toHaveValue('email')}
test('a lost save reply reloads one private version and approval does not enable delivery',async({page,fixture},info)=>{
 await openProperty(page,fixture.property);await fillSetup(page)
 let saves=0
 await page.route('**/api/crm/workspace',async route=>{if(route.request().method()!=='POST'||route.request().postDataJSON().action!=='save')return route.continue();saves++;const response=await route.fetch();expect(response.ok(),await response.text()).toBeTruthy();await route.fulfill({status:503,json:{error:'Save reply lost. Reload saved setup.'}})})
 await page.getByRole('button',{name:'Save mapping for review'}).click();await expect(page.getByText('Save reply lost. Reload saved setup.')).toBeVisible();await page.reload()
 await expect(page.getByText('Saved version 1 · Credentials saved on the server')).toBeVisible();expect(saves).toBe(1);expect((await fixture.db.from('crm_mapping_reviews').select('id').eq('property_id',fixture.property).eq('kind','save')).data).toHaveLength(1)
 const workspace=await page.request.get('/api/crm/workspace?propertyId='+fixture.property);expect(await workspace.text()).not.toContain('crm-browser-private-key');await expect(page.getByLabel('API key or access token')).toHaveCount(0)
 await page.getByRole('button',{name:'Create saved preview'}).click();await expect(page.getByRole('heading',{name:'Saved example preview'})).toBeVisible();await expect(page.getByText('example@example.invalid',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Approve this field mapping'}).click();await expect(page.getByText('Mapping approved · Provider verification required',{exact:true})).toBeVisible()
 const row=await fixture.db.from('integration_credentials').select('mapping_validated,status,crm_validation_receipt_id').eq('property_id',fixture.property).single();expect(row.data).toMatchObject({mapping_validated:false,status:'pending',crm_validation_receipt_id:null})
 const actions=await fixture.db.from('shared_action_events').select('action,request,result,training_eligible').eq('property_id',fixture.property).eq('product','crm');expect(actions.data).toHaveLength(3);expect(JSON.stringify(actions.data)).not.toContain('crm-browser-private-key');expect(actions.data!.every(a=>!a.training_eligible)).toBe(true)
 await page.screenshot({path:info.outputPath('crm-approved-review.png'),fullPage:true})
})
test('a changed real lead needs a fresh preview and rotating credentials invalidates approval',async({page,fixture},info)=>{
 await savedSetup(page,fixture);await page.getByLabel('Preview source').selectOption(fixture.lead);await page.getByRole('button',{name:'Create saved preview'}).click();await expect(page.getByRole('heading',{name:'Saved lead preview'})).toBeVisible()
 const changed=await fixture.db.from('leads').update({email:'changed@fixture.invalid'}).eq('id',fixture.lead);if(changed.error)throw changed.error
 await page.getByRole('button',{name:'Approve this field mapping'}).click();await expect(page.getByText('The lead changed after this preview. Create a fresh preview before approving.')).toBeVisible()
 await page.getByRole('button',{name:'Create saved preview'}).click();await expect(page.getByText('changed@fixture.invalid',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Approve this field mapping'}).click();await expect(page.getByText('Mapping approved · Provider verification required',{exact:true})).toBeVisible()
 await page.getByLabel('Replace stored credentials').check();await expect(page.getByLabel('API key or access token')).toHaveValue('');await page.getByLabel('API key or access token').fill('rotated-browser-key');await page.getByRole('button',{name:'Save mapping for review'}).click();await expect(page.getByText('Saved version 2 · Credentials saved on the server')).toBeVisible();await expect(page.getByText('Field mapping needs review',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Saved lead preview'})).toHaveCount(0)
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('crm-mobile.png'),fullPage:true})
})
test('duplicate targets are held without replacing the saved mapping',async({page,fixture})=>{
 await savedSetup(page,fixture);await page.getByLabel('Phone CRM field',{exact:true}).fill('email');await page.getByRole('button',{name:'Save mapping for review'}).click();await expect(page.getByText('Map each source to a different CRM field.')).toBeVisible();await page.getByRole('button',{name:'Reload saved setup'}).click();await expect(page.getByLabel('Phone CRM field',{exact:true})).toHaveValue('');expect((await fixture.db.from('crm_mapping_reviews').select('id').eq('property_id',fixture.property).eq('kind','save')).data).toHaveLength(1)
})

test('field discovery survives a lost reply and keeps fallback evidence visibly limited',async({page,fixture},info)=>{
 await savedSetup(page,fixture);let providerCalls=0
 await page.route('**/api/crm/setup',async route=>{
  const body=route.request().postDataJSON();if(route.request().method()!=='POST'||body.action!=='start')return route.continue()
  const saved=await rpc(fixture,'request_crm_setup_operation',{p_property_id:fixture.property,p_actor_id:fixture.actor,p_request_id:body.requestId,p_integration_id:body.integrationId,p_revision:body.revision,p_kind:body.kind});expect(saved.state).toBe('applied')
  const claim=await rpc(fixture,'claim_crm_setup_operation',{p_operation_id:body.requestId});expect(claim.state).toBe('claimed');providerCalls++
  await rpc(fixture,'finish_crm_setup_operation',{p_operation_id:body.requestId,p_claim_id:claim.claimId,p_result:{status:'limited',messageCode:'read_check_only',connection:{success:true,evidenceSource:'local_structure'},schema:{objectName:'Registrant',evidenceSource:'fallback',fields:[{name:'email',label:'Email',type:'email',required:true}]},suggestions:[{source:'email',target:'email',basis:'known_field_names'}],mappingIssues:{unknownTargets:['first_name'],unmappedRequired:[],schemaEvidence:'fallback'}}})
  await route.fulfill({status:503,json:{error:'Check reply lost. Reload saved checks.'}})
 })
 await page.getByRole('button',{name:'Discover CRM fields'}).click();await expect(page.getByText('Check reply lost. Reload saved checks.')).toBeVisible();await page.reload()
 await expect(page.getByRole('heading',{name:'CRM field discovery · Complete'})).toBeVisible();await expect(page.getByText('Credential format only — no provider response',{exact:true})).toBeVisible();await expect(page.getByText('This check has limited evidence. It does not verify delivery or all provider fields.')).toBeVisible();expect(providerCalls).toBe(1)
 await page.getByText('Review 1 fields · Documented defaults — provider schema not confirmed',{exact:true}).click();await expect(page.getByRole('cell',{name:'Required · email'})).toBeVisible()
 const credentials=await fixture.db.from('integration_credentials').select('mapping_validated,crm_validation_receipt_id').eq('property_id',fixture.property).single();expect(credentials.data).toEqual({mapping_validated:false,crm_validation_receipt_id:null})
 await page.screenshot({path:info.outputPath('crm-provider-evidence.png'),fullPage:true})
})
test('stopping a claimed check preserves its late receipt without accepting it',async({page,fixture})=>{
 await savedSetup(page,fixture);const connection=await fixture.db.from('integration_credentials').select('id,crm_revision').eq('property_id',fixture.property).single();if(connection.error)throw connection.error
 const operation=randomUUID();await rpc(fixture,'request_crm_setup_operation',{p_property_id:fixture.property,p_actor_id:fixture.actor,p_request_id:operation,p_integration_id:connection.data.id,p_revision:connection.data.crm_revision,p_kind:'connection'})
 const claim=await rpc(fixture,'claim_crm_setup_operation',{p_operation_id:operation});await page.getByRole('button',{name:'Reload saved checks'}).click();await expect(page.getByRole('heading',{name:'Connection check · Awaiting result'})).toBeVisible()
 await page.getByRole('button',{name:'Stop this check'}).click();await expect(page.getByRole('heading',{name:'Connection check · Stopped'})).toBeVisible()
 const late=await rpc(fixture,'finish_crm_setup_operation',{p_operation_id:operation,p_claim_id:claim.claimId,p_result:{status:'checked',messageCode:'read_check_only',connection:{success:true,evidenceSource:'provider_response'}}});expect(late.accepted).toBe(false)
 await page.getByRole('button',{name:'Reload saved checks'}).click();await expect(page.getByText('Result retained for history. It was not accepted for the current setup.')).toBeVisible();await expect(page.getByRole('heading',{name:'Connection check · Stopped'})).toBeVisible()
})

test('simultaneous retries produce one provider claim and one immutable result',async({page,fixture})=>{
 await savedSetup(page,fixture)
 const connection=await fixture.db.from('integration_credentials').select('id,crm_revision').eq('property_id',fixture.property).single();if(connection.error)throw connection.error
 const operation=randomUUID(),input={p_property_id:fixture.property,p_actor_id:fixture.actor,p_request_id:operation,p_integration_id:connection.data.id,p_revision:connection.data.crm_revision,p_kind:'connection'}
 const starts=await Promise.all(Array.from({length:4},()=>rpc(fixture,'request_crm_setup_operation',input)));expect(starts.filter(r=>r.state==='applied')).toHaveLength(1)
 const claims=await Promise.all(Array.from({length:4},()=>rpc(fixture,'claim_crm_setup_operation',{p_operation_id:operation})));expect(claims.filter(r=>r.state==='claimed')).toHaveLength(1)
 const claim=claims.find(r=>r.state==='claimed'),result={status:'checked',messageCode:'read_check_only',connection:{success:true,evidenceSource:'provider_response'}}
 const completions=await Promise.all(Array.from({length:4},()=>rpc(fixture,'finish_crm_setup_operation',{p_operation_id:operation,p_claim_id:claim.claimId,p_result:result})));expect(completions.filter(r=>r.state==='saved')).toHaveLength(1)
 expect((await fixture.db.from('crm_setup_receipts').select('operation_id').eq('operation_id',operation)).data).toHaveLength(1);expect((await fixture.db.from('shared_action_events').select('id').eq('episode_id',operation)).data).toHaveLength(2)
})


test('preserved Lasso setup shows continuity and retains discovery without asking for a new login',async({page,fixture},info)=>{
 const integration=randomUUID()
 execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN;
 ALTER TABLE public.integration_credentials DISABLE TRIGGER crm_configuration_version;
 INSERT INTO public.integration_credentials(id,property_id,platform,status,mapping_validated,credentials,field_mapping)VALUES('${integration}','${fixture.property}','lasso','connected',true,'{"api_key":"synthetic-browser-key","client_id":"client","project_id":"project"}','{"email":"email","first_name":"first_name"}');
 ALTER TABLE public.integration_credentials ENABLE TRIGGER crm_configuration_version;
 INSERT INTO public.crm_existing_connections(integration_id,property_id,org_id,revision,credentials_hash,mapping_hash)SELECT c.id,c.property_id,p.org_id,c.crm_revision,public.crm_configuration_hash(c.credentials),public.crm_configuration_hash(c.field_mapping) FROM public.integration_credentials c JOIN public.properties p ON p.id=c.property_id WHERE c.id='${integration}';COMMIT;`,stdio:['pipe','pipe','pipe']})
 await openProperty(page,fixture.property)
 await expect(page.getByText('Existing Lasso connection preserved.',{exact:true})).toBeVisible()
 await expect(page.getByText('New leads continue through the saved connection.',{exact:false})).toBeVisible()
 await expect(page.getByLabel('API key or access token')).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Save mapping for review'})).toBeDisabled()
 await expect(page.getByRole('button',{name:'Discover CRM fields',exact:true})).toBeEnabled()
 const response=await page.request.get('/api/crm/workspace?propertyId='+fixture.property)
 expect(await response.text()).not.toContain('synthetic-browser-key')
 const before=(await fixture.db.from('integration_credentials').select('crm_revision,credentials,field_mapping,status,mapping_validated').eq('id',integration).single()).data
 await page.getByRole('button',{name:'Create saved preview'}).click()
 await expect(page.getByRole('button',{name:'Existing mapping retained'})).toBeDisabled()
 expect((await fixture.db.from('integration_credentials').select('crm_revision,credentials,field_mapping,status,mapping_validated').eq('id',integration).single()).data).toEqual(before)
 await page.screenshot({path:info.outputPath('preserved-lasso-desktop.png'),fullPage:true})
 await page.setViewportSize({width:390,height:844})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
 await page.screenshot({path:info.outputPath('preserved-lasso-mobile.png'),fullPage:true})
})
