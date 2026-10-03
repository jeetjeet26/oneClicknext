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
  await check(db.from('properties').insert({ id: property, org_id: '22222222-2222-2222-2222-222222222222', name: 'LeadPulse browser fixture', property_type: 'multifamily' }))
  await check(db.from('leads').insert([{id:lead,property_id:property,first_name:'LeadPulse One',email:'leadpulse-one@fixture.invalid',source:'referral'},{id:second,property_id:property,first_name:'LeadPulse Two',source:'website form'}]))
  await provide({ property, lead, second, actor: actor.data.id, db })
 } finally {
  execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.leads WHERE property_id='${property}'; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
  expect((await db.from('properties').select('id').eq('id', property)).data).toHaveLength(0)
 }
} })
test.beforeEach(async ({page}) => { await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/) })


async function rpc(f:Fixture,name:string,args:Record<string,unknown>){const r=await f.db.rpc(name,args);if(r.error)throw r.error;return r.data}
async function openProperty(page:import('@playwright/test').Page,property:string){await page.addInitScript(p=>localStorage.setItem('p11_selected_property_id',p),property);await page.goto('/dashboard/leadpulse');await expect(page.getByRole('button',{name:'LeadPulse One',exact:true})).toBeVisible()}
test('opening a lead is read-only; lost score response recovers after reload',async({page,fixture},info)=>{
 await openProperty(page,fixture.property);await page.getByRole('button',{name:'LeadPulse One',exact:true}).click()
 await expect(page.getByText('This lead has not been scored. Opening it does not calculate a score.')).toBeVisible()
 expect((await fixture.db.from('lead_scores').select('id').eq('lead_id',fixture.lead)).data).toHaveLength(0)
 let posts=0
 await page.route('**/api/leadpulse/score',async route=>{if(route.request().method()!=='POST')return route.continue();posts++;const r=await route.fetch();expect(r.ok(),await r.text()).toBeTruthy();await route.fulfill({status:503,json:{error:'Score reply lost. Check saved progress.'}})})
 await page.getByRole('button',{name:'Calculate score',exact:true}).click();await expect(page.getByText('Score reply lost. Check saved progress.')).toBeAttached()
 await page.reload();await expect(page.getByText('Completed · 1 of 1 scored · 0 failed · 0 remaining')).toBeVisible();await page.getByRole('button',{name:'LeadPulse One',exact:true}).click()
 await expect(page.getByText('Saved scoring evidence is available.')).toBeVisible();expect(posts).toBe(1)
 expect((await fixture.db.from('lead_scores').select('id').eq('lead_id',fixture.lead)).data).toHaveLength(1)
 await page.getByRole('combobox',{name:'Assessment',exact:true}).selectOption('too_high');await page.getByLabel('Assessment reason').fill('This lead still needs a clear move-in timeline.');await page.getByRole('button',{name:'Save assessment',exact:true}).click();await expect(page.getByText('Assessment saved.')).toBeVisible()
 const reviews=await fixture.db.from('lead_score_reviews').select('score_id,judgment').eq('lead_id',fixture.lead);expect(reviews.data).toHaveLength(1);expect(reviews.data![0].judgment).toBe('too_high')
 const actions=await fixture.db.from('shared_action_events').select('action,training_eligible').eq('property_id',fixture.property).eq('action','lead.score.reviewed');expect(actions.data).toHaveLength(1);expect(actions.data![0].training_eligible).toBe(false)
 await page.screenshot({path:info.outputPath('score-evidence-review.png'),fullPage:true})
})
test('ambiguous engagement reply retries once and correction preserves its original evidence',async({page,fixture})=>{
 await openProperty(page,fixture.property);await page.getByRole('button',{name:'LeadPulse One',exact:true}).click();await expect(page.getByRole('button',{name:'Save report and rescore'})).toBeVisible()
 let posts=0;const keys:string[]=[]
 await page.route('**/api/leadpulse/events',async route=>{if(route.request().method()!=='POST')return route.continue();posts++;keys.push(route.request().postDataJSON().requestId);const r=await route.fetch();expect(r.ok(),await r.text()).toBeTruthy();if(posts===1)await route.fulfill({status:503,json:{error:'Event reply lost. Reload saved events or retry the same report.'}});else await route.fulfill({response:r})})
 await page.getByLabel('Report note (optional)').fill('Discussed availability by phone.');await page.getByRole('button',{name:'Save report and rescore'}).click();await expect(page.getByText('Event reply lost. Reload saved events or retry the same report.')).toBeVisible()
 await page.reload();await page.getByRole('button',{name:'LeadPulse One',exact:true}).click();await expect(page.getByText('1 recorded events')).toBeVisible();await page.getByLabel('Report note (optional)').fill('Discussed availability by phone.');await page.getByRole('button',{name:'Save report and rescore'}).click();await expect(page.getByLabel('Report note (optional)')).toHaveValue('');expect(keys[0]).toBe(keys[1])
 expect((await fixture.db.from('lead_engagement_events').select('id').eq('lead_id',fixture.lead)).data).toHaveLength(1);expect((await fixture.db.from('lead_scores').select('id').eq('lead_id',fixture.lead)).data).toHaveLength(1)
 await page.getByRole('button',{name:'Withdraw report',exact:true}).click();await page.getByLabel('Correction reason').fill('This call was entered for the wrong lead.');await page.getByRole('button',{name:'Confirm withdrawal'}).click();await expect(page.getByText('call inbound · Withdrawn')).toBeVisible()
 expect((await fixture.db.from('lead_engagement_events').select('id').eq('lead_id',fixture.lead)).data).toHaveLength(1);expect((await fixture.db.from('lead_event_corrections').select('id').eq('lead_id',fixture.lead)).data).toHaveLength(1)
 const score=await fixture.db.from('lead_scores').select('engagement_score').eq('lead_id',fixture.lead).order('scored_at',{ascending:false}).limit(1).single();expect(score.data!.engagement_score).toBe(0)
})
test('resumes an interrupted run and stops the remainder after a later reload',async({page,fixture})=>{
 const leads=Array.from({length:58},(_,i)=>({id:randomUUID(),property_id:fixture.property,first_name:`Batch fixture ${i}`,source:'referral'}));const inserted=await fixture.db.from('leads').insert(leads);if(inserted.error)throw inserted.error
 const batch=randomUUID();const initial=await rpc(fixture,'run_lead_score_batch',{p_property_id:fixture.property,p_actor_id:fixture.actor,p_request_id:batch});expect(initial.successful).toBe(25)
 await openProperty(page,fixture.property);await expect(page.getByText('In progress · 25 of 60 scored · 0 failed · 35 remaining')).toBeVisible()
 let controls=0
 await page.route('**/api/leadpulse/score',async route=>{if(route.request().method()!=='PATCH'||route.request().postDataJSON().action!=='continue')return route.continue();controls++;const r=await route.fetch();expect(r.ok(),await r.text()).toBeTruthy();await route.fulfill({status:503,json:{error:'Progress reply lost. Check saved progress.'}})})
 await page.getByRole('button',{name:'Continue saved run'}).click();await expect(page.getByText('Progress reply lost. Check saved progress.')).toBeVisible()
 await page.reload();await expect(page.getByText('In progress · 50 of 60 scored · 0 failed · 10 remaining')).toBeVisible();expect(controls).toBe(1)
 await page.getByRole('button',{name:'Stop remaining work'}).click();await expect(page.getByText('Stopped · 50 of 60 scored · 0 failed · 10 remaining')).toBeVisible()
 expect((await rpc(fixture,'continue_lead_score_batch',{p_property_id:fixture.property,p_actor_id:fixture.actor,p_batch_id:batch})).state).toBe('cancelled')
 const actions=await fixture.db.from('shared_action_events').select('id').eq('episode_id',batch).eq('action','lead.score.recalculated');expect(actions.data).toHaveLength(50)
})
test('all-property scoring and unscored filtering use the full saved selection',async({page,fixture})=>{
 await openProperty(page,fixture.property);await page.getByLabel('Score category').selectOption('unscored');await expect(page.getByText('2 matching leads · Page 1 of 1')).toBeVisible()
 await page.getByRole('button',{name:'Rescore all property leads'}).click();await expect(page.getByText('Completed · 2 of 2 scored · 0 failed · 0 remaining')).toBeVisible();await expect(page.getByText('No leads match these filters.')).toBeVisible()
 const scores=await fixture.db.from('lead_score_inputs').select('score_id').eq('property_id',fixture.property);expect(scores.data).toHaveLength(2)
 await page.getByLabel('Score category').selectOption('all');await page.getByLabel('Search leads').fill('LeadPulse Two');await expect(page.getByText('1 matching leads · Page 1 of 1')).toBeVisible();await expect(page.getByRole('button',{name:'LeadPulse One',exact:true})).toHaveCount(0)
})

test('a late score read cannot replace another lead and the drawer fits a phone',async({page,fixture},info)=>{
 await rpc(fixture,'run_lead_score_batch',{p_property_id:fixture.property,p_actor_id:fixture.actor,p_request_id:randomUUID(),p_lead_ids:[fixture.lead,fixture.second]})
 await openProperty(page,fixture.property)
 let release:()=>void=()=>{};const held=new Promise<void>(resolve=>{release=resolve})
 await page.route(`**/api/leadpulse/score?leadId=${fixture.lead}`,async route=>{const response=await route.fetch();await held;await route.fulfill({response}).catch(()=>{})})
 await page.getByRole('button',{name:'LeadPulse One',exact:true}).click();await expect(page.getByText('Loading saved score…')).toBeVisible();await page.getByRole('button',{name:'Close lead details'}).click()
 await page.getByRole('button',{name:'LeadPulse Two',exact:true}).click();await expect(page.getByText('Saved scoring evidence is available.')).toBeVisible();release()
 await page.setViewportSize({width:390,height:844});await expect(page.getByRole('dialog').getByRole('heading',{name:'LeadPulse Two',exact:true})).toBeVisible()
 const dimensions=await page.getByRole('dialog').evaluate(element=>({width:element.getBoundingClientRect().width,scroll:element.scrollWidth,client:element.clientWidth}));expect(dimensions.width).toBeLessThanOrEqual(390);expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client)
 await page.screenshot({path:info.outputPath('leadpulse-mobile.png'),fullPage:true})
})
