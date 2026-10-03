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
  await check(db.from('properties').insert({ id: property, org_id: '22222222-2222-2222-2222-222222222222', name: 'BrandForge sources fixture', property_type: 'multifamily' }))
  await provide({ property, brand, actor: actor.data.id, db })
 } finally {
  const objects = await db.storage.from('property-assets').list(`${property}/brandforge/primary_logo`)
  if(objects.data?.length)await db.storage.from('property-assets').remove(objects.data.map(item => `${property}/brandforge/primary_logo/${item.name}`))
  execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
  expect((await db.from('properties').select('id').eq('id', property)).data).toHaveLength(0)
 }
} })
test.beforeEach(async ({page}) => { await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/) })

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#123456"/></svg>'
test('imports a package and logo with recoverable source, rights and preview replies', async ({page,fixture},info)=>{
 test.setTimeout(120000)
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 const sourceRequests:string[]=[],reviewRequests:string[]=[],previewRequests:string[]=[];let generalKnowledgeCalls=0
 await page.route('**/api/documents/upload',async route=>{generalKnowledgeCalls++;await route.abort()})
 await page.route('**/api/brandforge/import/sources',async route=>{sourceRequests.push(route.request().postData()||'');const response=await route.fetch();expect(response.ok(),await response.text()).toBeTruthy();if(sourceRequests.length===1)return route.fulfill({status:503,json:{error:'Source response lost. Retry the same file.'}});await route.fulfill({response})})
 await page.route('**/api/brandforge/content-assets',async route=>{
  if(route.request().method()!=='PATCH')return route.continue()
  reviewRequests.push(route.request().postDataJSON().requestId);const response=await route.fetch();expect(response.ok(),await response.text()).toBeTruthy()
  if(reviewRequests.length===1)return route.fulfill({status:503,json:{error:'Rights response lost. Retry the same decision.'}})
  await route.fulfill({response})
 })
 await page.route('**/api/brandforge/import/preview',async route=>{if(route.request().method()!=='POST')return route.continue();previewRequests.push(route.request().postDataJSON().idempotencyKey);const response=await route.fetch();expect(response.ok(),await response.text()).toBeTruthy();if(previewRequests.length===1)return route.fulfill({status:503,json:{error:'Preview response lost. Retry.'}});await route.fulfill({response})})
 await page.goto(`/dashboard/brandforge/${fixture.property}`);await page.getByRole('link',{name:'Import existing brand'}).click()
 await page.getByLabel('Exact brand name').fill('Client Supplied Brand')
 await page.getByLabel('Primary logo',{exact:true}).setInputFiles({name:'client-logo.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)})
 await page.getByLabel('Brand package PDFs, TXT, or Markdown').setInputFiles({name:'client-brand.txt',mimeType:'text/plain',buffer:Buffer.from('Client supplied source for a welcoming community. Primary color #123456. A quiet and thoughtful brand voice.')})
 const extract=page.getByRole('button',{name:'Extract and review brand'})
 await expect(extract).toBeDisabled();await page.getByRole('checkbox').check();await extract.click();await expect(page.getByText('Source response lost. Retry the same file.')).toBeVisible();await extract.click();await expect(page.getByText('Preview response lost. Retry.')).toBeVisible();await extract.click();await expect(page.getByRole('heading',{name:'Review imported brand'})).toBeVisible()
 expect(sourceRequests).toHaveLength(2);expect(reviewRequests).toHaveLength(2);expect(new Set(reviewRequests).size).toBe(1);expect(previewRequests).toHaveLength(2);expect(new Set(previewRequests).size).toBe(1)
 await expect(page.getByText('Canonical contract JSON')).toHaveCount(0)
 await page.getByRole('radio',{name:/Uploaded package/}).check();await page.getByLabel('Color value',{exact:true}).first().fill('#ABCDEF')
 expect(generalKnowledgeCalls).toBe(0)
 const source=await fixture.db.from('brand_import_sources').select('id,content').eq('property_id',fixture.property);expect(source.error).toBeNull();expect(source.data).toHaveLength(1)
 const assets=await fixture.db.from('content_assets').select('id,governance_revision,approval_status').eq('property_id',fixture.property);expect(assets.data).toHaveLength(1);expect(assets.data?.[0]).toMatchObject({governance_revision:2,approval_status:'approved'})
 expect((await fixture.db.from('documents').select('id').eq('property_id',fixture.property)).data).toHaveLength(0)
 await page.screenshot({path:info.outputPath('reviewed-import.png'),fullPage:true})
 await page.getByRole('button',{name:'Approve existing brand'}).click();await expect(page.getByRole('heading',{name:'Existing brand approved'})).toBeVisible()
 const brand=await fixture.db.from('property_brand_assets').select('approval_status,approved_by,source_manifest,section_8_colors').eq('property_id',fixture.property).single();expect(brand.data).toMatchObject({approval_status:'approved',approved_by:fixture.actor});expect(JSON.stringify(brand.data?.source_manifest)).toContain(source.data![0].id);expect(JSON.stringify(brand.data?.section_8_colors)).toContain('#ABCDEF')
 const events=await fixture.db.from('shared_action_events').select('action,phase,training_eligible').eq('property_id',fixture.property).eq('phase','succeeded')
 for(const action of ['brand.source.saved','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.contract.imported'])expect(events.data?.filter(e=>e.action===action)).toHaveLength(1)
 expect(events.data?.some(e=>e.training_eligible)).toBe(false);expect(errors).toEqual([])
})
test('rejects stale reviews and private sources from another property',async({page,fixture})=>{
 const upload=await page.request.post('/api/brandforge/content-assets',{multipart:{propertyId:fixture.property,requestId:randomUUID(),role:'primary_logo',rightsStatus:'owned',file:{name:'client.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)}}});expect(upload.ok(),await upload.text()).toBeTruthy();const asset=(await upload.json()).asset
 const edit=await fixture.db.from('content_assets').update({rights_status:'restricted'}).eq('id',asset.id);if(edit.error)throw edit.error
 const review=await page.request.patch('/api/brandforge/content-assets',{headers:{origin:new URL(process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:9430').origin},data:{propertyId:fixture.property,assetId:asset.id,requestId:randomUUID(),revision:asset.governance_revision,approvalStatus:'approved',rightsStatus:'owned'}});expect(review.status()).toBe(409);expect((await review.json()).state).toBe('stale')
 const source=await page.request.post('/api/brandforge/import/sources',{multipart:{propertyId:fixture.property,requestId:randomUUID(),file:{name:'brand.txt',mimeType:'text/plain',buffer:Buffer.from('Private source text #123456')}}});expect(source.ok(),await source.text()).toBeTruthy();const id=(await source.json()).sourceId
 const preview=await page.request.post('/api/brandforge/import/preview',{data:{propertyId:'33333333-3333-3333-3333-333333333333',sourceType:'package',idempotencyKey:randomUUID(),sourceIds:[id]}});expect(preview.ok()).toBeFalsy();expect((await preview.json()).error).toContain('Every brand source must belong')
})
test('recovers an already stored upload and holds reuse of its request for different bytes',async({page,fixture})=>{
 const requestId=randomUUID(),path=`${fixture.property}/brandforge/primary_logo/${requestId}.svg`
 const stored=await fixture.db.storage.from('property-assets').upload(path,Buffer.from(svg),{contentType:'image/svg+xml'});if(stored.error)throw stored.error
 const body={propertyId:fixture.property,requestId,role:'primary_logo',rightsStatus:'owned',file:{name:'client.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)}}
 const first=await page.request.post('/api/brandforge/content-assets',{multipart:body});expect(first.ok(),await first.text()).toBeTruthy()
 const again=await page.request.post('/api/brandforge/content-assets',{multipart:body});expect(again.ok(),await again.text()).toBeTruthy();expect((await again.json()).state).toBe('replayed')
 const changed=await page.request.post('/api/brandforge/content-assets',{multipart:{...body,file:{...body.file,buffer:Buffer.from(svg.replace('#123456','#654321'))}}});expect(changed.status()).toBe(409)
 expect((await fixture.db.from('content_assets').select('id').eq('property_id',fixture.property)).data).toHaveLength(1)
})

test('resumes a saved preview after reload and hides it after a newer brand revision',async({page,fixture})=>{
 const preview=await page.request.post('/api/brandforge/import/preview',{data:{propertyId:fixture.property,sourceType:'manual',idempotencyKey:randomUUID(),manual:{identity:{name:'Saved Client Brand'}}}});expect(preview.ok(),await preview.text()).toBeTruthy()
 await page.goto(`/dashboard/brandforge/${fixture.property}/import`);await page.getByRole('button',{name:'Resume saved review 1'}).click();await expect(page.getByLabel('Name',{exact:true}).first()).toHaveValue('Saved Client Brand')
 await page.reload();await page.getByRole('button',{name:'Resume saved review 1'}).click();await expect(page.getByLabel('Name',{exact:true}).first()).toHaveValue('Saved Client Brand')
 const created=await fixture.db.from('property_brand_assets').insert({property_id:fixture.property,generated_by:fixture.actor,generation_status:'conversation'});if(created.error)throw created.error
 await page.reload();await expect(page.getByLabel('Exact brand name')).toBeVisible();await expect(page.getByRole('button',{name:'Resume saved review 1'})).toHaveCount(0)
})
