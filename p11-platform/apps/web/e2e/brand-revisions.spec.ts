import { expect, test as base } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const dbURL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const local = ['127.0.0.1','localhost']
const client = () => createClient(dbURL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const names = ['introduction','positioning','target_audience','personas','name_story','logo','typography','colors','design_elements','photo_yep','photo_nope','implementation']
type Fixture = { property: string; brand: string; actor: string; db: ReturnType<typeof client> }
const test = base.extend<{ fixture: Fixture }>({ fixture: async ({}, provide) => {
 if(!dbURL || !local.includes(new URL(dbURL).hostname) || !local.includes(new URL(process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430').hostname)) throw new Error('Isolated local test required')
 const db = client(), property = randomUUID(), brand = randomUUID()
 const check = async (promise: PromiseLike<{ error: unknown }>) => { const r = await promise; if(r.error)throw r.error }
 try {
  const actor = await db.from('profiles').select('id').eq('org_id','22222222-2222-2222-2222-222222222222').eq('role','admin').limit(1).single();if(actor.error)throw actor.error
  await check(db.from('properties').insert({ id: property, org_id: '22222222-2222-2222-2222-222222222222', name: 'BrandForge review fixture', property_type: 'multifamily' }))
  await check(db.from('property_brand_assets').insert({ id: brand, property_id: property, generated_by: actor.data.id, generation_status: 'reviewing', approval_status: 'reviewing', current_step: 1, current_step_name: 'introduction', draft_section: { step: 1, name: 'introduction', data: { content: 'Original brand draft' }, version: 1 }, proposed_sections: Object.fromEntries(names.map((name,index) => [`section_${index+1}_${name}`, { content: `Proposed ${name}`, ...(name==='name_story'?{name:'BrandForge Test Community'}:{}) }])) }))
  await provide({ property, brand, actor: actor.data.id, db })
 } finally {
  const objects = await db.storage.from('brand-assets').list(property)
  if(objects.data?.length)await db.storage.from('brand-assets').remove(objects.data.map(item => `${property}/${item.name}`))
  execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
  expect((await db.from('properties').select('id').eq('id', property)).data).toHaveLength(0)
 }
} })
test.beforeEach(async ({page}) => { await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/) })
async function open(page: import('@playwright/test').Page, f: Fixture) { await page.goto(`/dashboard/brandforge/${f.property}/create`);await expect(page.getByText('Original brand draft',{exact:true})).toBeVisible() }
async function saved(f:Fixture) { const r=await f.db.from('property_brand_assets').select('*').eq('id',f.brand).single();if(r.error)throw r.error;return r.data }

test('resumes a saved draft and recovers a lost edit response without duplicating the edit', async ({page,fixture},info) => {
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));let count=0;const ids:string[]=[]
 await page.route('**/api/brandforge/edit-section',async route=>{ids.push(route.request().postDataJSON().requestId);const response=await route.fetch();expect(response.ok()).toBeTruthy();if(++count===1)return route.fulfill({status:503,json:{error:'Save response lost. Retry the same edit.'}});return route.fulfill({response})})
 await open(page,fixture);await expect(page.getByText('Saved version 1',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Edit',exact:true}).click();await page.locator('textarea').fill('Reviewed brand promise');await page.getByRole('button',{name:'Save Edits',exact:true}).click();await expect(page.getByText('Save response lost. Retry the same edit.')).toBeVisible();await page.getByRole('button',{name:'Save Edits',exact:true}).click();await expect(page.getByText('Saved version 2',{exact:true})).toBeVisible()
 expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);expect((await saved(fixture)).revision).toBe(2)
 await page.reload();await expect(page.getByText('Reviewed brand promise',{exact:true})).toBeVisible();await expect(page.getByText('Saved version 2',{exact:true})).toBeVisible()
 const events=await fixture.db.from('shared_action_events').select('id,before_state,after_state,training_eligible').eq('property_id',fixture.property).eq('action','brand.section.edited');expect(events.data).toHaveLength(1);expect(events.data?.[0]).toMatchObject({training_eligible:false,before_state:{revision:1},after_state:{revision:2}})
 await page.screenshot({path:info.outputPath('saved-brand-revision.png'),fullPage:true});expect(errors).toEqual([])
})
test('holds an approval when another operator has changed the saved draft', async ({page,fixture}) => {
 await open(page,fixture)
 const newer={step:1,name:'introduction',data:{content:'Another operator’s newer draft'},version:2}
 const update=await fixture.db.from('property_brand_assets').update({draft_section:newer}).eq('id',fixture.brand);if(update.error)throw update.error
 await page.getByRole('button',{name:'Approve & Continue',exact:true}).click();await expect(page.getByText('This brand has changed. Reload the saved version before continuing.')).toBeVisible();expect((await saved(fixture)).current_step).toBe(1)
 await page.getByRole('button',{name:'Reload saved brand',exact:true}).click();await expect(page.getByText('Another operator’s newer draft',{exact:true})).toBeVisible()
})
test('reviews every generated section and creates a versioned local PDF export', async ({page,fixture},info) => {
 test.setTimeout(120_000);await open(page,fixture)
 for(let step=1;step<=12;step++) { await expect(page.getByText(`Step ${step} of 12`,{exact:true})).toBeVisible();await page.getByRole('button',{name:step===12?'Approve & Finish':'Approve & Continue',exact:true}).click() }
 await expect(page.getByRole('link',{name:/Download/}).first()).toBeVisible({timeout:30000})
 const brand=await saved(fixture);expect(brand.approval_status).toBe('approved');expect(brand.approved_by).toBe(fixture.actor);expect(brand.brand_book_pdf_url).toContain(`brand-book-${fixture.brand}-r`)
 const exported=await page.request.get(brand.brand_book_pdf_url);expect(exported.ok()).toBeTruthy();const pdf=await exported.body();expect(pdf.subarray(0,5).toString()).toBe('%PDF-');await writeFile(info.outputPath('brand-book.pdf'),pdf)
 const approvals=await fixture.db.from('shared_action_events').select('id').eq('property_id',fixture.property).eq('action','brand.section.approved').eq('phase','succeeded');expect(approvals.data).toHaveLength(12)
 const exports=await fixture.db.from('shared_action_events').select('id').eq('property_id',fixture.property).eq('action','brand.export.created');expect(exports.data).toHaveLength(1)
 await page.screenshot({path:info.outputPath('approved-brand-export.png'),fullPage:true})
 await page.getByRole('button',{name:'Revise brand',exact:true}).click();await expect(page.getByText('Step 1 of 12',{exact:true})).toBeVisible();expect((await saved(fixture)).approval_status).toBe('reviewing');expect((await saved(fixture)).brand_book_pdf_url).toBeNull()
})
test('stops an interrupted generation and refuses its late result', async ({page,fixture}) => {
 const id=randomUUID();const claim=await fixture.db.rpc('begin_brand_operation',{p_property_id:fixture.property,p_brand_asset_id:fixture.brand,p_actor_id:fixture.actor,p_request_id:id,p_revision:1,p_kind:'regenerate',p_input:{}});if(claim.error)throw claim.error
 await open(page,fixture);await expect(page.getByText(/A regenerate request is still open/)).toBeVisible();await page.getByRole('button',{name:'Stop this request'}).click();await expect(page.getByRole('button',{name:'Stop this request'})).toHaveCount(0)
 const late=await fixture.db.rpc('finish_brand_operation',{p_request_id:id,p_claim_token:claim.data.claimToken,p_updates:{draft_section:{step:1,name:'introduction',version:2,data:{content:'Late result'}}},p_result:{}});if(late.error)throw late.error;expect(late.data.state).toBe('cancelled');expect((await saved(fixture)).revision).toBe(1)
})

test('confirms an imported brand once and blocks a preview after a newer edit', async ({page,fixture}) => {
 const preview = await page.request.post('/api/brandforge/import/preview',{data:{propertyId:fixture.property,sourceType:'manual',idempotencyKey:randomUUID(),manual:{identity:{name:'Imported Community'},introduction:{content:'Supplied client brand'}}}})
 expect(preview.ok(), await preview.text()).toBeTruthy();const body = await preview.json()
 const request = {propertyId:fixture.property,importId:body.preview.id,requestId:randomUUID(),contract:body.preview.extracted_contract,resolutions:{}}
 const first = await page.request.post('/api/brandforge/import/confirm',{data:request});expect(first.ok(),await first.text()).toBeTruthy();const completed = await first.json()
 const again = await page.request.post('/api/brandforge/import/confirm',{data:request});expect(again.ok(),await again.text()).toBeTruthy();expect((await again.json()).contractHash).toBe(completed.contractHash)
 const brand = await saved(fixture);expect(brand.approval_status).toBe('approved');expect(brand.revision).toBe(2)
 const events=await fixture.db.from('shared_action_events').select('id').eq('property_id',fixture.property).eq('action','brand.contract.imported');expect(events.data).toHaveLength(1)
 const laterPreview = await page.request.post('/api/brandforge/import/preview',{data:{propertyId:fixture.property,sourceType:'manual',idempotencyKey:randomUUID(),manual:{identity:{name:'Proposed Replacement'}}}});expect(laterPreview.ok()).toBeTruthy();const later = await laterPreview.json()
 const edit=await fixture.db.from('property_brand_assets').update({conversation_summary:{source:'newer saved work'}}).eq('id',fixture.brand);if(edit.error)throw edit.error
 const stale=await page.request.post('/api/brandforge/import/confirm',{data:{propertyId:fixture.property,importId:later.preview.id,requestId:randomUUID(),contract:later.preview.extracted_contract,resolutions:{}}});expect(stale.ok()).toBeFalsy();expect((await stale.json()).error).toContain('saved brand changed')
 expect((await saved(fixture)).section_5_name_story.name).toBe('Imported Community')
})
test('serializes simultaneous requests for one saved brand revision', async ({fixture}) => {
 const id=randomUUID(), input={p_property_id:fixture.property,p_brand_asset_id:fixture.brand,p_actor_id:fixture.actor,p_request_id:id,p_revision:1,p_kind:'edit',p_input:{content:'One decision'}}
 const claims = await Promise.all(Array.from({length:4},()=>fixture.db.rpc('begin_brand_operation',input)))
 for(const claim of claims)if(claim.error)throw claim.error
 expect(claims.filter(c=>c.data.state==='claimed')).toHaveLength(1);expect(claims.filter(c=>c.data.state==='running')).toHaveLength(3)
 const claim=claims.find(c=>c.data.state==='claimed')!
 const done=await fixture.db.rpc('finish_brand_operation',{p_request_id:id,p_claim_token:claim.data.claimToken,p_updates:{draft_section:{step:1,name:'introduction',version:2,data:{content:'One decision'}}},p_result:{}});if(done.error)throw done.error;expect(done.data.state).toBe('applied')
 expect((await saved(fixture)).revision).toBe(2)
})
