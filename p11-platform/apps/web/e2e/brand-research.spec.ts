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
  await check(db.from('properties').insert({ id: property, org_id: '22222222-2222-2222-2222-222222222222', name: 'BrandForge research fixture', property_type: 'multifamily' }))
  await provide({ property, brand, actor: actor.data.id, db })
 } finally {
  const objects = await db.storage.from('property-assets').list(`${property}/brandforge/primary_logo`)
  if(objects.data?.length)await db.storage.from('property-assets').remove(objects.data.map(item => `${property}/brandforge/primary_logo/${item.name}`))
  execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
  expect((await db.from('properties').select('id').eq('id', property)).data).toHaveLength(0)
 }
} })
test.beforeEach(async ({page}) => { await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/) })


async function rpc(f:Fixture,name:string,args:Record<string,unknown>){const r=await f.db.rpc(name,args);if(r.error)throw r.error;return r.data}
test('recovers a lost saved research response without inventing market gaps or repeating work',async({page,fixture},info)=>{
 let posts=0
 await page.route('**/api/brandforge/analyze',async route=>{if(route.request().method()!=='POST')return route.continue();posts++;expect(route.request().postDataJSON().mode).toBe('saved');const response=await route.fetch();expect(response.ok(),await response.text()).toBeTruthy();await route.fulfill({status:503,json:{error:'Research reply lost. Reload the saved result.'}})})
 await page.goto(`/dashboard/brandforge/${fixture.property}/create`);await page.getByRole('button',{name:'Review saved competitor evidence'}).click();await expect(page.getByText('No saved competitor evidence was found. This does not establish that the market has no competitors.')).toBeVisible();await expect(page.getByText('Positioning ideas to validate',{exact:true})).toHaveCount(0)
 await page.reload();await expect(page.getByText('No saved competitor evidence was found. This does not establish that the market has no competitors.')).toBeVisible();expect(posts).toBe(1)
 const runs=await fixture.db.from('brand_research_runs').select('id,state,result').eq('property_id',fixture.property);expect(runs.data).toHaveLength(1);expect(runs.data![0].state).toBe('succeeded');expect(runs.data![0].result.marketGaps).toEqual([])
 const events=await fixture.db.from('shared_action_events').select('id,training_eligible').eq('property_id',fixture.property).in('action',['brand.research.requested','brand.research.completed']);expect(events.data).toHaveLength(2);expect(events.data!.every(e=>!e.training_eligible)).toBe(true)
 const dto=await page.request.get(`/api/brandforge/analyze?propertyId=${fixture.property}`);const text=await dto.text();expect(text).not.toContain('claim_token');expect(text).not.toContain('property_context')
 await page.screenshot({path:info.outputPath('research-evidence.png'),fullPage:true})
})
test('stops an interrupted report and rejects its late completion',async({page,fixture})=>{
 const id=randomUUID();const claim=await rpc(fixture,'begin_brand_research',{p_property_id:fixture.property,p_actor_id:fixture.actor,p_request_id:id,p_input:{mode:'saved',radiusMiles:3,maxCompetitors:10}})
 await page.route('**/api/brandforge/analyze',async route=>{if(route.request().method()==='POST')throw new Error('Opening saved research must not redispatch');await route.continue()})
 await page.goto(`/dashboard/brandforge/${fixture.property}/create`);await expect(page.getByRole('button',{name:'Stop research request'})).toBeVisible();await page.getByRole('button',{name:'Stop research request'}).click();await expect(page.getByRole('button',{name:'Review saved competitor evidence'})).toBeVisible()
 const late=await rpc(fixture,'finish_brand_research',{p_request_id:id,p_claim_token:claim.claimToken,p_result:{}});expect(late.state).toBe('cancelled')
})
test('shows sample-scoped hypotheses and sends the saved research identity into the brief',async({page,fixture})=>{
 const ids=Array.from({length:3},()=>randomUUID())
 for(const [index,id] of ids.entries()){
  const competitor=await fixture.db.from('competitors').insert({id,property_id:fixture.property,name:`Fixture competitor ${index+1}`,website_url:'https://example.invalid',is_active:true});if(competitor.error)throw competitor.error
  const evidence=await fixture.db.from('competitor_brand_intelligence').insert({competitor_id:id,brand_voice:'Luxury',confidence_score:0.8,pages_analyzed:2,last_analyzed_at:new Date().toISOString(),analysis_version:'fixture-v1'});if(evidence.error)throw evidence.error
 }
 await page.goto(`/dashboard/brandforge/${fixture.property}/create`);await page.getByRole('button',{name:'Review saved competitor evidence'}).click();await expect(page.getByText('Explore modern, technology-focused positioning: it does not appear in these 3 current competitor records.')).toBeVisible()
 const run=await fixture.db.from('brand_research_runs').select('id').eq('property_id',fixture.property).single();if(run.error)throw run.error
 let selected:string|null=null
 await page.route('**/api/brandforge/conversation',async route=>{const body=route.request().postDataJSON();selected=body.researchId;expect(body.competitiveContext).toBeUndefined();await route.fulfill({status:503,json:{state:'failed',error:'Provider fixture unavailable.'}})})
 await page.getByRole('button',{name:'Continue to Brand Strategy'}).click();await expect(page.getByText('Provider fixture unavailable.')).toBeVisible();expect(selected).toBe(run.data.id)
 const wrong=await page.request.post('/api/brandforge/conversation',{data:{propertyId:'33333333-3333-3333-3333-333333333333',requestId:randomUUID(),revision:0,action:'start',researchId:run.data.id}});expect(wrong.status()).toBe(409)
})
