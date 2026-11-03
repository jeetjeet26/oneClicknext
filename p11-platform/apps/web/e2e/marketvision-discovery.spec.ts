import {test, expect} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {createServer, type Server} from 'node:http'
import {execFileSync} from 'node:child_process'
import path from 'node:path'

// Run against a local app configured with DATA_ENGINE_URL=http://127.0.0.1:9347.
let server: Server
let captured: Record<string,unknown> | undefined
const engine=path.resolve(process.cwd(),'../../services/data-engine')
test.beforeAll(async()=>{
 if(!['localhost','127.0.0.1'].includes(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname) || !['localhost','127.0.0.1'].includes(new URL(process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430').hostname))throw Error('Local app and database required')
 if(process.env.DATA_ENGINE_URL !== 'http://127.0.0.1:9347')throw Error('Configure the local app and test with DATA_ENGINE_URL=http://127.0.0.1:9347')
 server=createServer(async(req,res)=>{
  try {
   let body='';for await(const chunk of req)body+=chunk
   captured=JSON.parse(body)
   const output=execFileSync(path.join(engine,'.venv/bin/python'),['tests/discovery_browser_fixture.py'],{cwd:engine,input:body,env:{...process.env,PYTHONPATH:engine}})
   res.writeHead(200,{'Content-Type':'application/json'});res.end(output)
  }catch{res.writeHead(500);res.end('{}')}
 })
 await new Promise<void>(resolve=>server.listen(9347,'127.0.0.1',resolve))
})
test.afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()))})

test('reviewed knowledge ranks direct matches, exposes alternatives and retains saved evidence',async({page},info)=>{
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!)
 const property=randomUUID(),actor='11111111-1111-1111-1111-111111111111',org='22222222-2222-2222-2222-222222222222'
 const check=async(request:PromiseLike<{error:unknown}>)=>{const {error}=await request;if(error)throw error}
 try{
  await check(db.from('properties').insert({id:property,org_id:org,name:'Discovery browser subject',property_type:'senior',address:{street:'1 Main Street',city:'City',state:'CA'}}))
  await check(db.from('community_access_grants').insert({actor_id:actor,property_id:property,capabilities:['read','manage'],granted_by:actor}))
  await check(db.from('property_intelligence_documents').insert({id:randomUUID(),property_id:property,org_id:org,kind:'fact',key:'community_subtype',actor_id:actor,status:'approved',payload:{field:'community_subtype',value:'Active adult apartments',source:'Reviewed staff fact',sourceUrl:'',observedAt:'2026-11-03',effectiveFrom:null,effectiveTo:null,reviewAfter:'2099-01-01',confidence:1,origin:'staff',visibility:'public'}}))
  await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/)
  await page.addInitScript(id=>localStorage.setItem('p11_selected_property_id',id),property)
  await page.goto('/dashboard/marketvision')
  await page.getByRole('button',{name:'Find competitors nearby'}).click()
  const panel=page.getByRole('region',{name:'Find nearby competitors'})
  await panel.getByLabel('Results to show').selectOption('10')
  await panel.getByRole('button',{name:'Search nearby'}).click()
  await expect(panel).toContainText('active adult')
  await expect(panel).toContainText('Showing 10 of 15')
  expect(captured?.community_context).toMatchObject({property_id:property,signals:expect.arrayContaining([expect.objectContaining({text:'community_subtype: Active adult apartments'})])})
  await expect(panel.getByRole('article')).toHaveCount(10)
  await panel.getByRole('button',{name:/Show more matches/}).click();await expect(panel.getByRole('article')).toHaveCount(15)
  await panel.getByLabel('Competitor relevance').selectOption('broader')
  await expect(panel.getByRole('article')).toHaveCount(2)
  const unknown=panel.getByRole('article').filter({hasText:'Unknown Grove'})
  await expect(unknown.getByRole('checkbox')).toBeDisabled()
  await unknown.getByRole('combobox').selectOption('multifamily');await unknown.getByRole('checkbox').check()
  await panel.getByRole('button',{name:'Add selected (1)'}).click();await expect(unknown).toContainText('Added')
  const saved=(await db.from('competitors').select('name,notes').eq('property_id',property)).data!
  expect(saved).toHaveLength(1);expect(saved[0].notes).toContain('Broader alternatives');expect(saved[0].notes).toContain('Community context:');expect(saved[0].notes).toContain('fact:')
  await page.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:info.outputPath('discovery-mobile.png')})
  await page.goto(`/dashboard/community?propertyId=${property}&section=facts`)
  await expect(page.getByText('Community subtype / living options',{exact:false}).first()).toBeVisible()
 } finally {
  execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.community_memory_events WHERE property_id='${property}'; DELETE FROM public.shared_context_snapshots WHERE property_id='${property}'; DELETE FROM public.shared_jobs WHERE property_id='${property}'; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
 }
})
