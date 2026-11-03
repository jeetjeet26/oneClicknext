import {requireLocalOnboardingSchema} from './helpers/onboarding-schema'
import {expect,test as base,type Page} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {extractOnboardingFixture} from './helpers/onboarding-worker'
const databaseURL=process.env.NEXT_PUBLIC_SUPABASE_URL||'',client=()=>createClient(databaseURL,process.env.SUPABASE_SERVICE_ROLE_KEY!)
const actor='11111111-1111-1111-1111-111111111111',org='22222222-2222-2222-2222-222222222222',pendingKey='p11.property-create.pending.v1'
type Fixture={db:ReturnType<typeof client>;source:string;contact:string;ids:Set<string>;name:string}
const test=base.extend<{fixture:Fixture}>({fixture:async({},provide)=>{
 if(!['localhost','127.0.0.1'].includes(new URL(databaseURL).hostname)||!['localhost','127.0.0.1'].includes(new URL(process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:9430').hostname))throw new Error('Local isolated fixture required')
 const db=client(),source=randomUUID(),contact=randomUUID(),ids=new Set([source]),name=`Property creation browser fixture ${randomUUID()}`
 try{
  expect((await db.from('properties').insert({id:source,org_id:org,name:`Template ${name}`,brand_voice:'Calm source voice',target_audience:'Reviewed source audience',pet_policy:{allowed:true},office_hours:{monday:'9 to 5'}})).error).toBeNull()
  expect((await db.from('community_access_grants').insert({actor_id:actor,property_id:source,capabilities:['read','manage','download'],granted_by:actor})).error).toBeNull()
  expect((await db.from('property_contacts').insert({id:contact,property_id:source,contact_type:'primary',name:'Copied owner',email:'owner@example.test',is_primary:true,special_instructions:'Exact source instructions'})).error).toBeNull()
  expect((await db.from('integration_credentials').insert({property_id:source,platform:'google_ads',status:'verified',account_id:'source-account',credentials:{access_token:'synthetic-template-secret'}})).error).toBeNull()
  await provide({db,source,contact,ids,name})
 }finally{
  const found=await db.from('properties').select('id').eq('name',name);expect(found.error).toBeNull();for(const row of found.data||[])ids.add(row.id)
  for(const id of ids){const files=await db.from('knowledge_files').select('storage_path').eq('property_id',id);if(files.data?.length)expect((await db.storage.from('knowledge-originals').remove(files.data.map(f=>f.storage_path))).error).toBeNull();execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN;CREATE TEMP TABLE fixture_jobs AS SELECT id FROM public.shared_jobs WHERE property_id='${id}';CREATE TEMP TABLE fixture_contexts AS SELECT id FROM public.shared_context_snapshots WHERE property_id='${id}';SET LOCAL session_replication_role=replica;UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${id}';DELETE FROM public.property_vertical_profile_versions WHERE property_id='${id}';DELETE FROM public.community_access_events WHERE property_id='${id}';DELETE FROM public.community_memory_events WHERE property_id='${id}';SET LOCAL session_replication_role=origin;DELETE FROM public.shared_jobs WHERE id IN(SELECT id FROM fixture_jobs);DELETE FROM public.properties WHERE id='${id}';DELETE FROM public.shared_context_snapshots WHERE id IN(SELECT id FROM fixture_contexts);COMMIT;`,stdio:['pipe','pipe','pipe']});for(const table of['properties','property_creation_requests','property_setup_changes','property_setup_state','shared_action_events','property_contacts'])expect((await db.from(table).select('*',{count:'exact',head:true}).eq(table==='properties'?'id':'property_id',id)).count).toBe(0)}
 }
}})
test.beforeAll(requireLocalOnboardingSchema)
test.beforeEach(async({page})=>{await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/,{timeout:30000})})
async function begin(page:Page,f:Fixture){await page.goto('/dashboard/properties/new');await page.getByLabel('Community Name',{exact:false}).fill(f.name);await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeEnabled()}
async function finishSteps(page:Page,fill=true){if(fill){await page.getByPlaceholder('Jane Smith').fill('New property owner');await page.getByPlaceholder('jane@property.com').fill('new-owner@example.test')}await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByRole('heading',{name:'Plan Your Connections'})).toBeVisible();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByRole('heading',{name:'Review & Finish Setup'})).toBeVisible()}
async function savedId(page:Page,f:Fixture){const id=await page.evaluate(k=>sessionStorage.getItem(k),pendingKey);expect(id).toBeTruthy();f.ids.add(id!);return id!}
async function counts(f:Fixture,id:string,complete:boolean){expect((await f.db.from('properties').select('id').eq('name',f.name)).data).toHaveLength(1);expect((await f.db.from('property_creation_requests').select('id').eq('property_id',id)).data).toHaveLength(1);expect((await f.db.from('onboarding_tasks').select('id').eq('property_id',id)).data).toHaveLength((await f.db.from('property_setup_state').select('connection_requests').eq('property_id',id).single()).data!.connection_requests.length+5);expect((await f.db.from('property_setup_changes').select('id').eq('property_id',id)).data).toHaveLength(complete?2:1);if(complete){expect((await f.db.from('property_contacts').select('id').eq('property_id',id)).data).toHaveLength(1);const events=await f.db.from('shared_action_events').select('action').eq('property_id',id).in('action',['property.created','property.onboarding.completed']);expect(events.error).toBeNull();expect(events.data?.map(x=>x.action).sort()).toEqual(['property.created','property.onboarding.completed'])}}
test('lost creation and completion replies recover the same property without duplicate contacts or tasks',async({page,fixture})=>{
 const unexpected:string[]=[];await page.route(/\/api\/(?:onboarding\/scrape-website|scrape|knowledge\/upload|brandforge\/generate)/,r=>{unexpected.push(r.request().url());return r.abort()})
 let lost=true;await page.route('**/api/properties/add',async r=>{const response=await r.fetch();expect(response.ok(),await response.text()).toBe(true);const id=(await response.json()).propertyId;fixture.ids.add(id);if(lost){lost=false;await r.abort('failed')}else await r.fulfill({response})})
 await begin(page,fixture);await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByText('Failed to fetch',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Add New Community'})).toBeVisible();const id=await savedId(page,fixture);await counts(fixture,id,false)
 await page.reload();await page.getByRole('button',{name:'Resume saved property'}).click();await expect(page.getByLabel('Community Name',{exact:false})).toHaveValue(fixture.name);await page.getByRole('button',{name:'Continue',exact:true}).click();await finishSteps(page)
 let completionLost=true;await page.route('**/api/properties/create?*',async r=>{const response=await r.fetch();expect(response.ok(),await response.text()).toBe(true);if(completionLost){completionLost=false;await r.abort('failed')}else await r.fulfill({response})})
 await page.getByRole('button',{name:'Add Property',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'Failed to fetch'})).toBeVisible();await counts(fixture,id,true);expect(await savedId(page,fixture)).toBe(id)
 await page.getByRole('button',{name:'Add Property',exact:true}).click();await expect(page.getByRole('heading',{name:'Property Added!'})).toBeVisible();await counts(fixture,id,true);expect(await page.evaluate(k=>sessionStorage.getItem(k),pendingKey)).toBeNull();expect(unexpected).toEqual([])
})
test('template copying requires current exact review and keeps plans separate from credentials',async({page,fixture},info)=>{
 await begin(page,fixture);const picker=page.getByRole('region',{name:'New property template'});await picker.getByLabel('Template property',{exact:true}).selectOption(fixture.source);await picker.getByLabel('Copy contact details').check();await picker.getByLabel('Copy service plans only').check();await picker.getByLabel('Copy brand voice, audience notes and property policies').check();await picker.getByRole('button',{name:'Review selected template'}).click();await expect(picker.getByRole('region',{name:'Exact template preview'})).toContainText('Calm source voice');await picker.getByLabel('Use this reviewed template').check()
 expect((await fixture.db.from('properties').update({brand_voice:'Updated source voice'}).eq('id',fixture.source)).error).toBeNull();await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByText('The selected template changed after review. Review its latest values before creating the property.',{exact:true})).toBeVisible();expect((await fixture.db.from('properties').select('id').eq('name',fixture.name)).data).toHaveLength(0)
 await picker.getByRole('button',{name:'Review selected template'}).click();await expect(picker.getByRole('region',{name:'Exact template preview'})).toContainText('Updated source voice');await picker.getByLabel('Use this reviewed template').check();await page.setViewportSize({width:390,height:844});await picker.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('property-template-mobile.png')});await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByPlaceholder('Jane Smith')).toHaveValue('Copied owner');const id=await savedId(page,fixture)
 const contacts=(await fixture.db.from('property_contacts').select('id,name,special_instructions').eq('property_id',id)).data!;expect(contacts).toHaveLength(1);expect(contacts[0].id).not.toBe(fixture.contact);expect(contacts[0].special_instructions).toBe('Exact source instructions');expect((await fixture.db.from('integration_credentials').select('id').eq('property_id',id)).data).toHaveLength(0)
 const r=await page.request.get(`/api/properties/creation?requestId=${id}`);expect(r.ok()).toBe(true);const data=await r.json();expect(data.snapshot.profile.brandVoice).toBe('Updated source voice');expect(data.snapshot.connectionRequests).toEqual([{platform:'google_ads',accountId:'',accountName:'',notes:''}]);expect(JSON.stringify(data)).not.toMatch(/synthetic-template-secret|source-account/)
 await page.reload();await page.getByRole('button',{name:'Resume saved property'}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await finishSteps(page,false);await page.getByRole('button',{name:'Add Property',exact:true}).click();await expect(page.getByRole('heading',{name:'Property Added!'})).toBeVisible();await counts(fixture,id,true)
})
test('a concurrent saved change holds completion and reload explicitly recovers its latest version',async({page,fixture})=>{
 await begin(page,fixture);await page.getByRole('button',{name:'Continue',exact:true}).click();await finishSteps(page);const id=await savedId(page,fixture)
 const read=await fixture.db.rpc('read_property_setup',{p_property_id:id,p_actor_id:actor});expect(read.error).toBeNull();const profile={...read.data.snapshot.profile,targetAudience:'Latest reviewed audience'};const change=await fixture.db.rpc('save_property_setup',{p_id:randomUUID(),p_property_id:id,p_actor_id:actor,p_input:{...read.data.snapshot,profile,expectedHash:read.data.snapshotHash,reason:'Concurrent synthetic review'}});expect(change.error).toBeNull();expect(change.data.state).toBe('saved')
 await page.getByRole('button',{name:'Add Property',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'Property details changed'})).toBeVisible();await expect(page.getByRole('link',{name:'Inspect saved property and history'})).toHaveAttribute('href',`/dashboard/properties/${id}/edit`);expect((await fixture.db.from('properties').select('onboarding_completed_at').eq('id',id).single()).data?.onboarding_completed_at).toBeNull()
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Reload saved setup'}).click();await page.getByRole('button',{name:'Resume saved property'}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await finishSteps(page);await page.getByRole('button',{name:'Add Property',exact:true}).click();await expect(page.getByRole('heading',{name:'Property Added!'})).toBeVisible();expect((await fixture.db.from('properties').select('target_audience').eq('id',id).single()).data?.target_audience).toBe('Latest reviewed audience')
})

test('expanded setup survives reload and retains a real reviewed upload without publishing it',async({page,fixture},info)=>{
 test.setTimeout(120000)
 await begin(page,fixture)
 await page.getByRole('combobox',{name:'Subject',exact:true}).selectOption('real_estate_development')
 await page.getByRole('combobox',{name:'Site scope',exact:true}).selectOption('development')
 await page.getByRole('combobox',{name:'Sector',exact:true}).selectOption('residential')
 await page.getByRole('combobox',{name:'Business model',exact:true}).selectOption('for_sale')
 await page.getByRole('combobox',{name:'Lifecycle',exact:true}).selectOption('prelaunch')
 await page.getByRole('combobox',{name:'Offering type',exact:true}).selectOption('home_plan')
 await page.getByLabel('Country',{exact:true}).fill('Canada')
 await page.getByLabel('Property timezone',{exact:true}).fill('America/Vancouver')
 await page.getByRole('button',{name:'Continue',exact:true}).click()
 const id=await savedId(page,fixture)
 await page.getByPlaceholder('Jane Smith').fill('Private setup owner')
 await page.getByPlaceholder('jane@property.com').fill('internal@example.test')
 await page.getByLabel('Public contact name',{exact:true}).fill('Sales team')
 await page.getByLabel('Public phone',{exact:true}).fill('+1 555 0100')
 await page.getByLabel('Public email',{exact:true}).fill('public@example.test')
 await page.getByRole('checkbox',{name:/confirm.*public/i}).check()
 await page.getByRole('button',{name:'Save draft',exact:true}).click()
 await expect(page.getByRole('status')).toContainText('saved privately')
 await page.reload();await page.getByRole('button',{name:'Resume saved property'}).click()
 await expect(page.getByLabel('Public email',{exact:true})).toHaveValue('public@example.test')
 await page.getByRole('button',{name:'Continue',exact:true}).click()
 await page.getByRole('checkbox',{name:'Website',exact:true}).check()
 await page.getByRole('checkbox',{name:'Plan CRM System',exact:true}).check()
 await page.getByLabel('Setup owner',{exact:true}).fill('Launch owner')
 await page.getByRole('button',{name:'Continue',exact:true}).click()
 await page.getByRole('button',{name:'Add source reference'}).click()
 await page.getByRole('combobox',{name:'Source 1 type',exact:true}).selectOption('document')
 await page.getByLabel('Source 1 name').fill('Current sales brochure')
 await page.getByLabel('Source 1 owner').fill('Content owner')
 await page.getByLabel('Source 1 observation date').fill('2026-10-30')
 await page.getByLabel('Source 1 review date').fill('2026-11-30')
 await page.getByRole('button',{name:'Save draft',exact:true}).click()
 await expect(page.getByRole('status')).toContainText('saved privately')
 await page.reload();await page.getByRole('button',{name:'Resume saved property'}).click()
 await expect(page.getByLabel('Source 1 name')).toHaveValue('Current sales brochure')
 await page.getByText('Upload and review private originals now (optional)',{exact:true}).click()
 const files=page.getByRole('region',{name:'Private original files'})
 await files.getByRole('button',{name:'Add private original'}).click()
 await files.getByLabel('Original file',{exact:true}).setInputFiles({name:'onboarding-brochure.txt',mimeType:'text/plain',buffer:Buffer.from('Supplied brochure: appointment hours are 9 to 5 on weekdays. Review before publication.')})
 await files.getByLabel('File title',{exact:true}).fill('Current sales brochure')
 await files.getByRole('button',{name:'Retain exact original'}).click()
 await expect(files).toContainText('Original retained and verified')
 await files.getByRole('button',{name:'Extract original text'}).click()
 await expect(files).toContainText('queued');await extractOnboardingFixture(fixture.db,id);await files.getByRole('button',{name:/Current sales brochure onboarding-brochure/}).click();await expect(files.getByLabel('Reviewed file text',{exact:true})).toHaveValue(/appointment hours/)
 await files.getByRole('checkbox',{name:/I reviewed the original/}).check()
 await files.getByRole('button',{name:'Save reviewed file text'}).click()
 await expect(files.getByRole('link',{name:'Open reviewed text'})).toBeVisible()
 await page.getByRole('button',{name:'Continue',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Connections — 1 planned'})).toBeVisible()
 await page.getByRole('button',{name:'Add Property',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Property Added!'})).toBeVisible()
 await page.waitForTimeout(3200)
 await expect(page).toHaveURL(/properties\/new/)
 const property=(await fixture.db.from('properties').select('settings,address,current_vertical_profile_version_id').eq('id',id).single()).data!
 expect(property.settings).toMatchObject({timezone:'America/Vancouver',publicContact:{email:'public@example.test',confirmed:true},onboarding:{sources:[{label:'Current sales brochure',owner:'Content owner'}]}})
 expect(property.address.country).toBe('Canada')
 const classification=(await fixture.db.from('property_vertical_profile_versions').select('mapping_status,profile').eq('id',property.current_vertical_profile_version_id).single()).data!
 expect(classification.mapping_status).toBe('confirmed');expect(classification.profile.attributes.siteforgeComposition).toMatchObject({transaction:'for_sale',archetype:'for_sale_community'})
 const tasks=(await fixture.db.from('onboarding_tasks').select('metadata').eq('property_id',id)).data!
 expect(tasks.map(t=>t.metadata.setupKey)).toEqual(expect.arrayContaining(['connection_crm','legal','brand','inventory','readiness']))
 expect(tasks.map(t=>t.metadata.setupKey)).not.toContain('connection_google_ads')
 expect((await fixture.db.from('integration_credentials').select('*',{head:true,count:'exact'}).eq('property_id',id)).count).toBe(0)
 expect((await fixture.db.from('knowledge_materials').select('active_version_id').eq('property_id',id).single()).data?.active_version_id).toBeNull()
 await page.getByRole('link',{name:'Continue property setup'}).click()
 await expect(page.getByRole('region',{name:'Saved setup handoff'})).toContainText('Current sales brochure')
 await expect(page.getByRole('combobox',{name:'Property',exact:true})).toHaveValue(id)
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:info.outputPath('onboarding-handoff-mobile.png'),fullPage:true})
 await page.getByRole('link',{name:'Connection settings',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Integrations Status',exact:true})).toBeVisible()
 await expect(page.getByRole('combobox',{name:'Property',exact:true})).toHaveValue(id)
 await page.goto(`/dashboard/community?propertyId=${id}&section=overview&setupPanel=advertising#community-settings`)
 await expect(page.getByRole('button',{name:'Advertising connections',exact:true})).toHaveAttribute('aria-expanded','true')
})

test('shared intake is keyboard accessible and has no WCAG AA violations in light and dark mobile layouts',async({page},info)=>{
 for(const theme of ['light','dark']){
  await page.setViewportSize({width:390,height:844});await page.goto('/dashboard/properties/new')
  await expect(page.getByRole('heading',{name:'Add New Community'})).toBeFocused()
  await page.keyboard.press('Tab');await expect(page.getByLabel('Community Name',{exact:true})).toBeFocused()
  await page.getByText('Identity, ownership and market details',{exact:true}).click()
  await page.getByText('Address, website and property details',{exact:true}).click()
  // Exercise each rendered theme after the saved account preference has hydrated.
  // This tests the wizard's theme/contrast, not account-preference persistence.
  await page.evaluate(value=>{const root=document.documentElement;root.classList.remove('light','dark');root.classList.add(value);root.dataset.theme=value;root.style.colorScheme=value},theme)
  await expect(page.locator('html')).toHaveClass(new RegExp(theme))
  const panel=page.getByRole('heading',{name:'Add New Community'}).locator('..')
  if(theme==='dark')await expect(panel).not.toHaveCSS('background-color','rgb(255, 255, 255)')
  else await expect(panel).toHaveCSS('background-color','rgb(255, 255, 255)')
  await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')})
  const violations=await page.evaluate(async()=>{
   const axe=(window as unknown as {axe:{run:(context:string,options:unknown)=>Promise<{violations:Array<{id:string;impact:string;nodes:Array<{target:string[]}>}>}>}}).axe
   return (await axe.run('.setup-shell',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)}))
  })
  expect(violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.getByRole('heading',{name:'Add New Community'}).scrollIntoViewIfNeeded()
  await page.screenshot({path:info.outputPath(`onboarding-${theme}-mobile.png`),fullPage:true})
 }
})
