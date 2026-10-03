import {test as base,expect,type Page} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {currentWork,evidenceSchema} from '../utils/agency/contracts'
const baseURL=process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:9430',url=process.env.NEXT_PUBLIC_SUPABASE_URL!,password='local-agency-fixture-password'
const service=()=>createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})
function sql(input:string){return execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input,stdio:['pipe','pipe','pipe']})}
type Fixture={id:string;email:string;org:string;property:string;other:string;db:ReturnType<typeof service>}
async function event(f:Fixture,property=f.property){const id=randomUUID();const a=await f.db.from('shared_action_episodes').insert({id,org_id:f.org,property_id:property,actor_id:f.id,origin:'console'});expect(a.error).toBeNull();const b=await f.db.from('shared_action_events').insert({id,episode_id:id,org_id:f.org,property_id:property,actor_id:f.id,product:'siteforge',action:'site.fixture.failed',evidence:'server_confirmed',phase:'failed',request:{private:'fixture source payload'},result:{}});expect(b.error).toBeNull();return id}
const test=base.extend<{fixture:Fixture}>({fixture:async({},provide)=>{
 if(!['127.0.0.1','localhost'].includes(new URL(url).hostname)||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Local disposable fixtures only')
 const db=service(),email='agency-browser-'+randomUUID()+'@p11.test',created=await db.auth.admin.createUser({email,password,email_confirm:true});expect(created.error).toBeNull()
 const id=created.data.user!.id,org=randomUUID(),property=randomUUID(),other=randomUUID(),f={id,email,org,property,other,db}
 try{sql(`BEGIN;INSERT INTO public.organizations(id,name)VALUES('${org}','Agency browser fixture');SELECT set_config('p11.team_scope','${org}',true);UPDATE public.profiles SET org_id='${org}',role='admin'WHERE id='${id}';INSERT INTO public.properties(id,org_id,name)VALUES('${property}','${org}','Agency A fixture'),('${other}','${org}','Agency B fixture');COMMIT;`);await event(f);await provide(f)}
 finally{sql(`BEGIN;SET LOCAL session_replication_role=replica;UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id IN('${property}','${other}');DELETE FROM public.property_vertical_profile_versions WHERE property_id IN('${property}','${other}');SET LOCAL session_replication_role=origin;CREATE TEMP TABLE agency_fixture_jobs ON COMMIT DROP AS SELECT id FROM public.shared_jobs WHERE property_id IN('${property}','${other}');CREATE TEMP TABLE agency_fixture_contexts ON COMMIT DROP AS SELECT id FROM public.shared_context_snapshots WHERE property_id IN('${property}','${other}');DELETE FROM public.properties WHERE id IN('${property}','${other}');DELETE FROM public.shared_jobs WHERE id IN(SELECT id FROM agency_fixture_jobs);DELETE FROM public.shared_context_snapshots WHERE id IN(SELECT id FROM agency_fixture_contexts);SELECT set_config('p11.team_scope','${org}',true);UPDATE public.profiles SET org_id=NULL,role='viewer'WHERE org_id='${org}';DELETE FROM public.organizations WHERE id='${org}';COMMIT;`);expect((await db.auth.admin.deleteUser(id)).error).toBeNull()}
}})
test.setTimeout(120000)
const card=(p:Page)=>p.getByRole('article',{name:'SiteForge recommendation'}),history=(p:Page)=>p.getByRole('region',{name:'Saved agency reviews'})
async function login(p:Page,f:Fixture){await p.goto('/auth/login?redirect=%2Fdashboard%2Fagency');await p.getByLabel('Email address').fill(f.email);await p.getByLabel('Password',{exact:true}).fill(password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await expect(p).toHaveURL(/dashboard\/agency/,{timeout:30000});await p.getByRole('combobox',{name:'Property',exact:true}).selectOption(f.property);await expect(card(p)).toBeVisible({timeout:30000})}
async function reviews(f:Fixture){const r=await f.db.from('agency_observation_reviews').select('*').eq('property_id',f.property);expect(r.error).toBeNull();return r.data!}
test('review exact evidence, retain history, reject stale source and respect current role',async({page,fixture:f},info)=>{
 await login(page,f);await expect(page.getByRole('region',{name:'Evidence coverage'}).getByRole('article')).toHaveCount(19)
 await card(page).getByLabel('Your decision').selectOption('watch');await card(page).getByLabel('Review reason').fill('Known fixture issue; check later');await card(page).getByRole('button',{name:'Save review'}).click();await expect(page.getByRole('status')).toContainText('Review saved')
 expect((await reviews(f))).toHaveLength(1);await page.reload();await expect(card(page)).toContainText('Last review of this evidence: Keep watching');await expect(history(page)).toContainText('Known fixture issue')
 await event(f);await card(page).getByLabel('Review reason').fill('This stale form should not be saved');await card(page).getByRole('button',{name:'Save review'}).click();await expect(page.getByRole('alert').filter({hasText:'The evidence changed'})).toContainText('The evidence changed');expect((await reviews(f))).toHaveLength(1)
 await page.getByRole('button',{name:'Refresh evidence'}).click();await expect(card(page)).toContainText('2 failed actions');await card(page).getByLabel('Your decision').selectOption('not_actionable');await card(page).getByLabel('Review reason').fill('Retained local test failure, no live work affected');await card(page).getByRole('button',{name:'Save review'}).click();await expect(history(page).getByRole('article')).toHaveCount(2)
 const events=await f.db.from('shared_action_events').select('*').eq('property_id',f.property).eq('product','agency').eq('evidence','server_confirmed');expect(events.data).toHaveLength(2);expect(events.data?.every(e=>!e.training_eligible&&!JSON.stringify(e).includes('no live work'))).toBe(true)
 await page.locator('main').evaluate(element=>{element.scrollTop=0});await page.screenshot({path:info.outputPath('agency-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.locator('main').evaluate(element=>{element.scrollTop=0});await page.screenshot({path:info.outputPath('agency-mobile.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
 sql(`BEGIN;SELECT set_config('p11.team_scope','${f.org}',true);UPDATE public.profiles SET role='viewer'WHERE id='${f.id}';COMMIT;`);await page.getByRole('button',{name:'Refresh evidence'}).click();await expect(page.getByText('A manager can save review decisions.')).toBeVisible();await expect(card(page).getByRole('button',{name:'Save review'})).toBeDisabled()
 const r=await page.request.post('/api/agency/observation',{data:{propertyId:f.property,requestId:randomUUID(),operation:'cancel_unused',inputHash:'a'.repeat(64)}});expect(r.status()).toBe(403)
})
test('recover committed lost reply and close an unused request before its late arrival',async({page,fixture:f})=>{
 await login(page,f);let dropped=false
 await page.route('**/api/agency/observation',async route=>{if(route.request().method()==='POST'&&!dropped){dropped=true;const response=await route.fetch();expect(response.ok()).toBe(true);await route.abort('failed')}else await route.continue()})
 await card(page).getByLabel('Review reason').fill('Retained despite lost reply');await card(page).getByRole('button',{name:'Save review'}).click();await expect(page.getByRole('region',{name:'Unconfirmed review'})).toBeVisible();await page.reload();await page.getByRole('button',{name:'Check saved review'}).click();await expect(page.getByRole('status')).toContainText('Found your saved review');expect((await reviews(f))).toHaveLength(1)
 await page.unroute('**/api/agency/observation');let late:unknown
 await page.route('**/api/agency/observation',async route=>{const body=route.request().postDataJSON();if(body?.operation==='review'){late=body;await route.abort('failed')}else await route.continue()})
 await card(page).getByLabel('Review reason').fill('Unused request should never apply');await card(page).getByRole('button',{name:'Save review'}).click();await expect(page.getByRole('region',{name:'Unconfirmed review'})).toBeVisible();await page.getByRole('button',{name:'Check saved review'}).click();await expect(page.getByRole('alert').filter({hasText:'not been found'})).toContainText('not been found');await page.getByRole('button',{name:'Close unused request'}).click();await expect(page.getByRole('status')).toContainText('Unused request closed');await page.unroute('**/api/agency/observation')
 const r=await page.request.post('/api/agency/observation',{data:late});expect(r.status()).toBe(409);expect((await reviews(f)).filter(r=>r.kind==='review')).toHaveLength(1)
})
test('late responses from the previous property cannot fill the new property',async({page,fixture:f})=>{
 await login(page,f);let release:(()=>void)|undefined;let arrived:(()=>void)|undefined;const started=new Promise<void>(r=>arrived=r),held=new Promise<void>(r=>release=r)
 await page.route('**/api/agency/observation?**',async route=>{const u=new URL(route.request().url());if(u.searchParams.get('propertyId')===f.property&&!u.searchParams.get('kind')){const r=await route.fetch();arrived?.();await held;await route.fulfill({response:r})}else await route.continue()})
 await page.getByRole('button',{name:'Refresh evidence'}).click();await started;await page.getByRole('combobox',{name:'Property',exact:true}).selectOption(f.other);await expect(page.getByText('No recent failures or unfinished items were found in the checked sources.')).toBeVisible();release?.();await expect(card(page)).toHaveCount(0);await expect(history(page)).toContainText('No agency reviews saved yet')
})

test('old held work without failed events stays reviewable until its native state resolves',async({page,fixture:f},info)=>{
 const competitor=randomUUID(),context=randomUUID(),ids=Array.from({length:6},()=>randomUUID()),old=new Date(Date.now()-30*86400000).toISOString()
 const check=async(p:PromiseLike<{error:unknown}>)=>expect((await p).error).toBeNull()
 // These are local fixtures with real foreign keys, held jobs and no executable queue entries.
 await check(f.db.from('competitors').insert({id:competitor,property_id:f.property,name:'Agency source fixture'}))
 await check(f.db.from('shared_context_snapshots').insert({id:context,org_id:f.org,property_id:f.property,source_domain:'marketvision.source',context_payload:{private:'Private source context fixture'}}))
 for(const id of ids){
  await check(f.db.from('shared_jobs').insert({id,org_id:f.org,property_id:f.property,domain:'marketvision.source',subject_type:'competitor',subject_id:competitor,lifecycle_status:'failed'}))
  await check(f.db.from('marketvision_source_requests').insert({id,property_id:f.property,org_id:f.org,actor_id:f.id,competitor_id:competitor,context_id:context,input:{private:'Private source input fixture'},input_hash:'fixture',source_snapshot:{private:'Private saved content fixture'},state:'held',created_at:old,updated_at:old}))
 }
 await login(page,f)
 const recommendation=page.getByRole('article',{name:'MarketVision recommendation'}),work=recommendation.getByRole('region',{name:'Current unfinished work'})
 await expect(recommendation).toContainText('0 failed actions');await expect(work).toContainText('6 unfinished items');await expect(work).toContainText('Showing the 5 oldest of 6')
 const response=await page.request.get(`/api/agency/observation?propertyId=${f.property}`);expect(response.ok()).toBe(true);const contents=await response.text();expect(contents).not.toContain('Private');expect(contents).not.toContain('claim_token')
 await recommendation.getByLabel('Your decision').selectOption('watch');await recommendation.getByLabel('Review reason').fill('Waiting for the client to review source inputs');await recommendation.getByRole('button',{name:'Save review'}).click();await expect(recommendation).toContainText('Last review of this evidence');await expect(work).toContainText('6 unfinished items')
 await check(f.db.from('marketvision_source_requests').update({state:'stopped'}).eq('id',ids[0]))
 await recommendation.getByLabel('Review reason').fill('Old summary must be refreshed');await recommendation.getByRole('button',{name:'Save review'}).click();await expect(page.getByRole('alert').filter({hasText:'The evidence changed'})).toBeVisible()
 await page.getByRole('button',{name:'Refresh evidence'}).click();await expect(work).toContainText('5 unfinished items')
 await page.setViewportSize({width:390,height:844});await work.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('agency-held-work-mobile.png')})
 for(const id of ids.slice(1))await check(f.db.from('marketvision_source_requests').update({state:'stopped'}).eq('id',id))
 await page.getByRole('button',{name:'Refresh evidence'}).click();await expect(recommendation).toHaveCount(0);await expect(history(page)).toContainText('Waiting for the client')
 const saved=(await reviews(f)).find(r=>r.kind==='review'),evidence=evidenceSchema.parse(saved?.evidence);expect(currentWork(evidence)?.total).toBe(6);expect(evidence.failedCount).toBe(0)
 await page.reload();await expect(history(page)).toContainText('Waiting for the client');await expect(recommendation).toHaveCount(0)
})
