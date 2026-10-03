import { expect, test as base, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const dbURL=process.env.NEXT_PUBLIC_SUPABASE_URL||''
const client=()=>createClient(dbURL,process.env.SUPABASE_SERVICE_ROLE_KEY!)
type Fixture={property:string;otherProperty:string;competitor:string;actor:string;db:ReturnType<typeof client>}
const test=base.extend<{fixture:Fixture}>({fixture:async({},provide)=>{
 if(!['localhost','127.0.0.1'].includes(new URL(dbURL).hostname)||!['localhost','127.0.0.1'].includes(new URL(process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:9430').hostname))throw new Error('Local isolated fixture required')
 const db=client(),property=randomUUID(),otherProperty=randomUUID(),competitor=randomUUID(),actor='11111111-1111-1111-1111-111111111111'
 const check=async(p:PromiseLike<{error:unknown}>)=>{const r=await p;if(r.error)throw r.error}
 try{
  await check(db.from('properties').insert([{id:property,org_id:'22222222-2222-2222-2222-222222222222',name:'MarketVision reporting browser fixture'},{id:otherProperty,org_id:'22222222-2222-2222-2222-222222222222',name:'MarketVision other reporting browser fixture'}]))

  await provide({property,otherProperty,competitor,actor,db})
 }finally{
  for(const p of [property,otherProperty])execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN;SET LOCAL session_replication_role=replica;UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${p}';DELETE FROM public.property_vertical_profile_versions WHERE property_id='${p}';SET LOCAL session_replication_role=origin;CREATE TEMP TABLE fixture_jobs ON COMMIT DROP AS SELECT id FROM public.shared_jobs WHERE property_id='${p}';CREATE TEMP TABLE fixture_contexts ON COMMIT DROP AS SELECT id FROM public.shared_context_snapshots WHERE property_id='${p}';DELETE FROM public.properties WHERE id='${p}';DELETE FROM public.shared_jobs WHERE id IN(SELECT id FROM fixture_jobs);DELETE FROM public.shared_context_snapshots WHERE id IN(SELECT id FROM fixture_contexts);COMMIT;`,stdio:['pipe','pipe','pipe']})
  for(const table of ['competitors','scrape_config','marketvision_decisions','shared_action_events'])expect((await db.from(table).select('id').eq('property_id',property)).data).toHaveLength(0)
 }
}})
test.beforeEach(async({page})=>{page.on('pageerror',error=>console.error('Response browser page error:',error.message));await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/,{timeout:30000})})


async function openMarket(page:Page,f:Fixture,tab='Competitors'){await page.addInitScript(p=>localStorage.setItem('p11_selected_property_id',p),f.property);await page.goto('/dashboard/marketvision');await page.getByRole('button',{name:tab,exact:true}).click()}
async function seed(f:Fixture){
 const second=randomUUID(),third=randomUUID(),ids=[randomUUID(),randomUUID(),randomUUID()]
 const check=async(p:PromiseLike<{error:unknown}>)=>{const r=await p;if(r.error)throw r.error}
 await check(f.db.from('competitors').insert([{id:f.competitor,property_id:f.property,name:'North sample',is_active:true},{id:second,property_id:f.property,name:'South sample',is_active:true},{id:third,property_id:f.property,name:'Unknown sample',is_active:true}]))
 await check(f.db.from('competitor_units').insert([{id:ids[0],competitor_id:f.competitor,unit_type:'Studio zero',bedrooms:0,rent_min:0,rent_max:null,available_count:null},{id:ids[1],competitor_id:second,unit_type:'One bedroom',bedrooms:1,rent_min:2400,rent_max:2500,available_count:0},{id:ids[2],competitor_id:third,unit_type:'Unknown price',bedrooms:1,rent_min:null,rent_max:null,available_count:null}]))
 const ago=(days:number)=>new Date(Date.now()-days*86400000).toISOString()
 await check(f.db.from('competitor_price_history').insert([{competitor_unit_id:ids[0],rent_min:0,recorded_at:ago(35),source:'manual'},{competitor_unit_id:ids[1],rent_min:2000,recorded_at:ago(35),source:'manual'},{competitor_unit_id:ids[1],rent_min:2400,recorded_at:ago(1),source:'manual'}]))
 return ids
}

test('overview shows actual coverage, zero and unknown prices with fixed sample history',async({page,fixture},info)=>{
 await seed(fixture);await openMarket(page,fixture,'Overview')
 const summary=page.getByRole('region',{name:'Market summary'}),comparison=page.getByRole('region',{name:'Rent comparison'}),history=page.getByRole('region',{name:'Saved pricing history'})
 await expect(summary).toContainText('Price effective dates are unknown for 3 of 3 plans.')
 await expect(comparison.getByRole('row').filter({hasText:'North sample'})).toContainText('$0')
 await expect(comparison.getByRole('row').filter({hasText:'Unknown sample'})).toContainText('Unknown')
 await expect(history).toContainText('Same 2 of 3 floor plans across 2 competitors')
 await expect(history).toContainText('changed +20% in this fixed sample')
 await comparison.getByLabel('Bedroom filter').selectOption('0');await expect(comparison.getByRole('row').filter({hasText:'South sample'})).toContainText('Unknown');await expect(comparison.getByRole('row').filter({hasText:'North sample'})).toContainText('$0')
 await comparison.getByText('Pricing evidence (1 floor plans)',{exact:true}).click();await expect(comparison).toContainText('No linked source capture.');await expect(comparison).toContainText('Price effective date: Unknown')
 const report=await page.request.get(`/api/marketvision/report?propertyId=${fixture.property}&days=30`);expect(report.status()).toBe(200);const body=await report.json();expect(body.report.trendCoverage.netChangePct).toBe(20);expect(body.report.recommendations).toEqual([])
 await page.setViewportSize({width:390,height:844});await comparison.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('market-reporting-mobile.png')})
})

test('failed reads remain errors and a property change clears old metrics',async({page,fixture})=>{
 await seed(fixture);await page.route('**/api/marketvision/analysis?*',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Complete evidence is unavailable'})}));await openMarket(page,fixture,'Overview')
 for(const name of ['Market summary','Rent comparison','Saved pricing history']){const p=page.getByRole('region',{name});await expect(p.getByRole('alert')).toContainText('Complete evidence is unavailable');await expect(p).not.toContainText('No active competitors saved.')}
 await page.unroute('**/api/marketvision/analysis?*');await page.getByRole('button',{name:'Reload overview'}).click();await expect(page.getByRole('region',{name:'Market summary'})).toContainText('3 of 3 plans')
 await page.getByLabel('Property',{exact:true}).selectOption(fixture.otherProperty);await expect(page.getByLabel('Property',{exact:true})).toHaveValue(fixture.otherProperty);await page.getByRole('button',{name:'Overview',exact:true}).click();await expect(page.getByRole('region',{name:'Rent comparison'})).toContainText('No active competitors saved.',{timeout:30000});await expect(page.getByRole('region',{name:'Rent comparison'})).not.toContainText('North sample');await expect(page.getByRole('region',{name:'Saved pricing history'})).toContainText('insufficient comparable evidence')
})

test('late filter results cannot replace the latest bedroom selection',async({page,fixture})=>{
 await seed(fixture);await openMarket(page,fixture,'Overview');const comparison=page.getByRole('region',{name:'Rent comparison'});await expect(comparison.getByRole('row').filter({hasText:'North sample'})).toContainText('$0')
 let release!:()=>void,started!:()=>void;const waiting=new Promise<void>(r=>{release=r}),arrived=new Promise<void>(r=>{started=r})
 await page.route('**/api/marketvision/analysis?*',async r=>{if(new URL(r.request().url()).searchParams.get('bedrooms')==='0'){const reply=await r.fetch();started();await waiting;try{await r.fulfill({response:reply})}catch{/* Aborted by the newer filter. */}}else await r.continue()})
 await comparison.getByLabel('Bedroom filter').selectOption('0');await arrived;await comparison.getByLabel('Bedroom filter').selectOption('1');await expect(comparison.getByRole('row').filter({hasText:'South sample'})).toContainText('$2,400');release();await expect(comparison.getByRole('row').filter({hasText:'North sample'})).toContainText('Unknown');await expect(comparison.getByLabel('Bedroom filter')).toHaveValue('1');await page.unrouteAll({behavior:'wait'})
})
