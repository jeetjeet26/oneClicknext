import {test,expect} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {readFileSync,writeFileSync,chmodSync} from 'node:fs'
import {join} from 'node:path'
const output=process.env.P11_CLIENT_LIFECYCLE_ARTIFACT_DIR
const fixture=output?JSON.parse(readFileSync(join(output,'journey.json'),'utf8')):null
const session=output?join(output,'private-browser-session.json'):undefined
if(session)chmodSync(session,0o600)
test.skip(!output,'Requires the retained connected-client rehearsal')
test.use({storageState:session})
test('the same client publishes reviewed facts and survives a delayed property switch',async({page},info)=>{
 page.setDefaultTimeout(15000)
 for(const address of[process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.PLAYWRIGHT_BASE_URL!])if(!['127.0.0.1','localhost'].includes(new URL(address).hostname))throw new Error('Local fixture only')
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!)
 await page.addInitScript(id=>localStorage.setItem('p11_selected_property_id',id),fixture.property);await page.goto('/dashboard/community');await page.getByRole('button',{name:'Knowledge Base',exact:true}).click();const facts=page.getByRole('region',{name:'Reviewed assistant facts'});await facts.getByLabel('Reason for this facts decision',{exact:true}).fill('Review the corrected client property facts');await facts.getByRole('button',{name:'Prepare complete facts draft'}).click();await expect(facts.getByLabel('Exact retained facts')).toContainText('Carlsbad');await facts.getByLabel('Reason for this facts decision',{exact:true}).fill('Approve the exact current property facts for the assistant');await facts.getByRole('checkbox').check();await facts.getByRole('button',{name:'Publish reviewed facts',exact:true}).click();await expect(facts).toContainText('Reviewed facts available to Luma')
 const served=await db.rpc('read_serving_assistant_facts',{p_property_id:fixture.property});expect(served.error).toBeNull();expect(served.data.contextMarkdown).toContain('Carlsbad')
 await page.getByRole('button',{name:'Overview',exact:true}).click();await expect(page.getByRole('status',{name:'Loading property data'})).toHaveCount(0);await page.setViewportSize({width:390,height:844});await page.locator('main').evaluate(e=>e.scrollTop=0);await page.screenshot({path:info.outputPath('client-property-loaded-mobile.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 // A second property is an input fixture used only to exercise selection isolation.
 const other=fixture.otherProperty||crypto.randomUUID();if(!fixture.otherProperty)expect((await db.from('properties').insert({id:other,org_id:fixture.org,name:'Lifecycle second property'})).error).toBeNull();fixture.otherProperty=other;writeFileSync(join(output!,'journey.json'),JSON.stringify(fixture,null,2),{mode:0o600})
 await page.reload();await page.getByRole('button',{name:'Overview',exact:true}).click();await expect(page.getByRole('status',{name:'Loading property data'})).toHaveCount(0)
 let release:()=>void=()=>{},start:()=>void=()=>{};const held=new Promise<void>(r=>release=r),started=new Promise<void>(r=>start=r)
 await page.route('**/api/community/profile?propertyId='+fixture.property,async r=>{const response=await r.fetch();start();await held;await r.fulfill({response}).catch(()=>{})})
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await started;await page.getByRole('combobox',{name:'Property',exact:true}).selectOption(other);release();await expect(page.getByRole('status',{name:'Loading property data'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Overview',exact:true})).toHaveAttribute('aria-pressed','true');expect(new URL(page.url()).searchParams.has('assistantFactVersion')).toBe(false);await expect(page.locator('main').getByRole('alert')).toHaveCount(0);await expect(page.getByText('Synthetic client contact',{exact:true})).toHaveCount(0)
 await page.unroute('**/api/community/profile?propertyId='+fixture.property);await page.getByRole('combobox',{name:'Property',exact:true}).selectOption(fixture.property);await expect(page.getByRole('status',{name:'Loading property data'})).toHaveCount(0);await expect(page.getByText('Synthetic client contact',{exact:true})).toBeVisible()
 fixture.stages.push('reviewed-facts-published','delayed-property-response-isolated');fixture.actionCount=(await db.from('shared_action_events').select('id',{count:'exact',head:true}).eq('org_id',fixture.org)).count;writeFileSync(join(output!,'journey.json'),JSON.stringify(fixture,null,2),{mode:0o600})
})
