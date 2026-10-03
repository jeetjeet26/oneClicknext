import { expect, test as base } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const dbURL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const local = ['127.0.0.1','localhost']
const client = () => createClient(dbURL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
type Fixture = { property: string; brand: string; actor: string; db: ReturnType<typeof client> }
const test = base.extend<{ fixture: Fixture }>({ fixture: async ({}, provide) => {
 if(!dbURL || !local.includes(new URL(dbURL).hostname) || !local.includes(new URL(process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430').hostname)) throw new Error('Isolated local test required')
 const db = client(), property = randomUUID(), brand = randomUUID()
 const check = async (promise: PromiseLike<{ error: unknown }>) => { const r = await promise; if(r.error)throw r.error }
 try {
  const actor = await db.from('profiles').select('id').eq('org_id','22222222-2222-2222-2222-222222222222').eq('role','admin').limit(1).single();if(actor.error)throw actor.error
  await check(db.from('properties').insert({ id: property, org_id: '22222222-2222-2222-2222-222222222222', name: 'BrandForge conversation fixture', property_type: 'multifamily' }))
  await provide({ property, brand, actor: actor.data.id, db })
 } finally {
  const objects = await db.storage.from('brand-assets').list(property)
  if(objects.data?.length)await db.storage.from('brand-assets').remove(objects.data.map(item => `${property}/${item.name}`))
  execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
  expect((await db.from('properties').select('id').eq('id', property)).data).toHaveLength(0)
 }
} })
test.beforeEach(async ({page}) => { await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/) })

async function rpc(f:Fixture,name:string,args:Record<string,unknown>){const r=await f.db.rpc(name,args);if(r.error)throw r.error;return r.data}
async function emptyBrief(f:Fixture){const id=randomUUID();const claim=await rpc(f,'begin_brand_operation',{p_property_id:f.property,p_brand_asset_id:null,p_actor_id:f.actor,p_request_id:id,p_revision:0,p_kind:'brief',p_input:{action:'start'}});f.brand=claim.brandAssetId;return {id,claim}}
test('reopens a failed first response as a conversation and uses the saved revision for a new attempt',async({page,fixture})=>{
 const {id,claim}=await emptyBrief(fixture);await rpc(fixture,'finish_brand_operation',{p_request_id:id,p_claim_token:claim.claimToken,p_updates:{},p_result:{},p_error:'generation_failed'})
 const requests:Array<{revision:number;requestId:string}>=[]
 await page.route('**/api/brandforge/conversation',async route=>{requests.push(route.request().postDataJSON());await route.fulfill({status:503,json:{state:'failed',error:'Provider fixture unavailable.'}})})
 await page.goto(`/dashboard/brandforge/${fixture.property}/create`);await expect(page.getByRole('button',{name:'Begin brand conversation'})).toBeVisible();expect(requests).toHaveLength(0)
 await page.getByRole('button',{name:'Begin brand conversation'}).click();await expect(page.getByText('Provider fixture unavailable.')).toBeVisible();await page.getByRole('button',{name:'Begin brand conversation'}).click();expect(requests).toHaveLength(2);expect(requests.map(r=>r.revision)).toEqual([1,1]);expect(requests[0].requestId).not.toBe(requests[1].requestId)
 await page.getByRole('button',{name:'Reload saved conversation'}).click();await expect(page.getByRole('button',{name:'Begin brand conversation'})).toBeVisible();expect(requests).toHaveLength(2)
})
test('shows and stops an unfinished first response before allowing another generation',async({page,fixture})=>{
 const {id,claim}=await emptyBrief(fixture);let providerCalls=0
 await page.route('**/api/brandforge/conversation',async route=>{providerCalls++;await route.abort()})
 await page.goto(`/dashboard/brandforge/${fixture.property}/create`);await expect(page.getByRole('button',{name:'Stop open request'})).toBeVisible();expect(providerCalls).toBe(0)
 await page.getByRole('button',{name:'Stop open request'}).click();await expect(page.getByRole('button',{name:'Begin brand conversation'})).toBeVisible()
 const late=await rpc(fixture,'finish_brand_operation',{p_request_id:id,p_claim_token:claim.claimToken,p_updates:{gemini_conversation_history:[{role:'assistant',content:'Late provider result'}],generation_status:'conversation'},p_result:{}});expect(late.state).toBe('cancelled');expect(providerCalls).toBe(0)
})
test('reloads a lost saved message response without repeating the message',async({page,fixture})=>{
 const inserted=await fixture.db.from('property_brand_assets').insert({id:fixture.brand,property_id:fixture.property,generated_by:fixture.actor,generation_status:'conversation',gemini_conversation_history:[{role:'assistant',content:'What is your vision?'}]});if(inserted.error)throw inserted.error
 let messages=0
 await page.route('**/api/brandforge/conversation',async route=>{
  const body=route.request().postDataJSON();expect(body.action).toBe('message');messages++
  const claim=await rpc(fixture,'begin_brand_operation',{p_property_id:fixture.property,p_brand_asset_id:fixture.brand,p_actor_id:fixture.actor,p_request_id:body.requestId,p_revision:body.revision,p_kind:'brief',p_input:{action:'message',message:body.message}})
  const history=[{role:'assistant',content:'What is your vision?'},{role:'user',content:body.message},{role:'assistant',content:'Saved reply about your audience.'}]
  await rpc(fixture,'finish_brand_operation',{p_request_id:body.requestId,p_claim_token:claim.claimToken,p_updates:{gemini_conversation_history:history,generation_status:'conversation'},p_result:{conversationHistory:history,status:'in_progress'}})
  await route.fulfill({status:503,json:{error:'Saved response was lost.'}})
 })
 await page.goto(`/dashboard/brandforge/${fixture.property}/create`);await expect(page.getByText('What is your vision?',{exact:true})).toBeVisible();expect(messages).toBe(0)
 const input=page.getByPlaceholder('Type your response...');await input.fill('A welcoming community');await page.getByRole('button',{name:'Send brand message'}).click();await expect(page.getByText('Saved response was lost.')).toBeVisible();await expect(input).toHaveValue('A welcoming community')
 await page.getByRole('button',{name:'Reload saved conversation'}).click();await expect(page.getByText('Saved reply about your audience.')).toBeVisible();await expect(input).toHaveValue('');expect(messages).toBe(1)
 const events=await fixture.db.from('shared_action_events').select('id').eq('property_id',fixture.property).eq('action','brand.brief.saved');expect(events.data).toHaveLength(1)
})
