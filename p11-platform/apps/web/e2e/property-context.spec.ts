import {expect, test, type Page} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430'
const databaseURL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const local = ['localhost','127.0.0.1']
const propertyId = '33333333-3333-3333-3333-333333333333'
test.skip(!local.includes(new URL(baseURL).hostname), 'Local console qualification only')
test.beforeEach(async ({page}) => {
  await page.goto('/auth/login')
  await page.getByLabel('Email address').fill('local-admin@p11.test')
  await page.getByLabel('Password',{exact:true}).fill('local-dev-password')
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await expect(page).not.toHaveURL(/\/auth\/login/)
  // Dispose the sign-in destination before observing requests from the gated page.
  await page.goto('about:blank')
})
async function seedList(page: Page) {
  const response = await page.request.get('/api/properties')
  expect(response.ok()).toBeTruthy()
  const property = (await response.json()).properties.find((p: {id: string}) => p.id === propertyId)
  expect(property).toBeTruthy()
  return {properties:[property]}
}
function scopedRequests(page: Page) {
  const requests: string[] = []
  page.on('request',request=>{
    const url = new URL(request.url())
    if (url.pathname === '/api/activity') requests.push(request.url())
  })
  return requests
}
test('failed property load blocks product requests and retry recovers the real property',async({page},info)=>{
 const actual = await seedList(page);let failed = true
 await page.route('**/api/properties',route=>route.fulfill(failed ? {status:503,json:{error:'Fixture outage'}} : {json:actual}))
 const requests = scopedRequests(page)
 await page.goto('/dashboard/activity')
 await expect(page.getByRole('heading',{name:'Properties unavailable'})).toBeVisible()
 await expect(page.getByRole('combobox',{name:'Property',exact:true})).toBeDisabled()
 await expect(page.locator('header select option')).toHaveText(['Properties unavailable'])
 expect(requests).toEqual([])
 await page.screenshot({path:info.outputPath('property-unavailable-desktop.png')})
 failed = false
 await page.getByRole('button',{name:'Retry loading properties'}).click()
 await expect(page.getByRole('combobox',{name:'Property',exact:true})).toHaveValue(propertyId)
 await expect(page.getByRole('heading',{name:'Activity history'})).toBeVisible()
 await expect.poll(()=>requests.length).toBeGreaterThan(0)
 expect(requests.every(url=>!url.includes('undefined') && !url.includes('123e4567'))).toBeTruthy()
})
test('a slow property request holds product mounting and emits no empty-scope observation',async({page})=>{
 const actual=await seedList(page);let release!:()=>void
 const pending=new Promise<void>(resolve=>{release=resolve})
 await page.route('**/api/properties',async route=>{await pending;await route.fulfill({json:actual})})
 const requests=scopedRequests(page)
 await page.goto('/dashboard/activity')
 await expect(page.getByRole('region',{name:'Property access'})).toContainText('Loading your properties')
 expect(requests).toEqual([])
 release()
 await expect(page.getByRole('heading',{name:'Activity history'})).toBeVisible()
 await expect.poll(()=>requests.length).toBeGreaterThan(0)
})
test('malformed property responses stay unavailable instead of looking like an empty organization',async({page})=>{
 await page.route('**/api/properties',route=>route.fulfill({json:{properties:[{id:'invalid',name:'Broken response'}]}}))
 const requests=scopedRequests(page)
 await page.goto('/dashboard/activity')
 await expect(page.getByRole('heading',{name:'Properties unavailable'})).toBeVisible()
 await expect(page.getByRole('heading',{name:'Add your first property'})).toBeHidden()
 expect(requests).toEqual([])
})
test('an empty organization can reach property setup without invented property context',async({page},info)=>{
 await page.setViewportSize({width:390,height:844})
 await page.route('**/api/properties',route=>route.fulfill({json:{properties:[]}}))
 const requests=scopedRequests(page)
 await page.goto('/dashboard/activity')
 await expect(page.getByRole('heading',{name:'Add your first property'})).toBeVisible()
 await expect(page.locator('header select option')).toHaveText(['No properties yet'])
 expect(requests).toEqual([])
 await page.screenshot({path:info.outputPath('property-empty-mobile.png')})
 await page.getByRole('link',{name:'Add property',exact:true}).click()
 await expect(page.getByLabel('Community Name',{exact:false})).toBeVisible()
 await expect(page.getByRole('region',{name:'Property access'})).toBeHidden()
})
test('an unavailable saved selection is replaced and blocked browser storage does not break selection',async({page})=>{
 const actual=await seedList(page)
 await page.route('**/api/properties',route=>route.fulfill({json:actual}))
 await page.addInitScript(()=>localStorage.setItem('p11_selected_property_id','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))
 await page.goto('/dashboard/activity')
 await expect(page.getByRole('combobox',{name:'Property',exact:true})).toHaveValue(propertyId)
 await expect.poll(()=>page.evaluate(()=>localStorage.getItem('p11_selected_property_id'))).toBe(propertyId)
 await page.addInitScript(()=>{
   const get=Storage.prototype.getItem,set=Storage.prototype.setItem,remove=Storage.prototype.removeItem
   Storage.prototype.getItem=function(key){if(key==='p11_selected_property_id')throw new DOMException('Blocked','SecurityError');return get.call(this,key)}
   Storage.prototype.setItem=function(key,value){if(key==='p11_selected_property_id')throw new DOMException('Blocked','SecurityError');return set.call(this,key,value)}
   Storage.prototype.removeItem=function(key){if(key==='p11_selected_property_id')throw new DOMException('Blocked','SecurityError');return remove.call(this,key)}
 })
 await page.reload()
 await expect(page.getByRole('heading',{name:'Activity history'})).toBeVisible()
 await expect(page.getByRole('combobox',{name:'Property',exact:true})).toHaveValue(propertyId)
})
test('first property save refreshes context and a failed final refresh retries without another save',async({page},info)=>{
 if(!databaseURL||!local.includes(new URL(databaseURL).hostname))throw new Error('Local database required')
 const db=createClient(databaseURL,process.env.SUPABASE_SERVICE_ROLE_KEY!)
 const name=`Property context fixture ${randomUUID()}`
 let createdId='',failFinalRead=false,saveCount=0
 try {
  await page.route('**/api/properties',async route=>{
   if(failFinalRead)return route.fulfill({status:503,json:{error:'Fixture read outage'}})
   if(!createdId)return route.fulfill({json:{properties:[]}})
   const response=await route.fetch();const data=await response.json()
   return route.fulfill({json:{properties:data.properties.filter((p:{id:string})=>p.id===createdId)}})
  })
  await page.route('**/api/properties/add',async route=>{
   const response=await route.fetch();expect(response.ok()).toBeTruthy()
   createdId=(await response.json()).property.id
   return route.fulfill({response})
  })
  await page.route('**/api/properties/create*',async route=>{
   saveCount++;const response=await route.fetch();expect(response.ok()).toBeTruthy()
   failFinalRead=true;return route.fulfill({response})
  })
  await page.goto('/dashboard/activity')
  await page.getByRole('link',{name:'Add property',exact:true}).click()
  await page.getByLabel('Community Name',{exact:false}).fill(name)
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await expect(page.getByRole('combobox',{name:'Property',exact:true})).toHaveValue(createdId)
  await page.getByPlaceholder('Jane Smith').fill('Local Owner')
  await page.getByPlaceholder('jane@property.com').fill('local-owner@example.invalid')
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Connect Your Platforms'})).toBeVisible()
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await page.getByRole('button',{name:/^Upload Documents Upload/}).click()
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await page.getByRole('button',{name:'Add Property',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Property Added!'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Retry loading saved property'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Back to Property'})).toBeDisabled()
  await page.screenshot({path:info.outputPath('property-saved-retry.png')})
  failFinalRead=false
  await page.getByRole('button',{name:'Retry loading saved property'}).click()
  await expect(page.getByRole('button',{name:'Back to Property'})).toBeEnabled()
  await page.getByRole('button',{name:'Back to Property'}).click()
  await expect(page).toHaveURL(/\/dashboard\/community$/)
  await expect(page.getByRole('combobox',{name:'Property',exact:true})).toHaveValue(createdId)
  expect(saveCount).toBe(1)
  const saved=await db.from('properties').select('id').eq('name',name)
  expect(saved.error).toBeNull();expect(saved.data).toHaveLength(1)
 } finally {
  const found=await db.from('properties').select('id').eq('name',name)
  if(found.error)throw found.error
  for(const row of found.data||[]) {
   execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${row.id}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${row.id}'; SET LOCAL session_replication_role=origin; DELETE FROM public.properties WHERE id='${row.id}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
  }
  expect((await db.from('properties').select('id').eq('name',name)).data).toHaveLength(0)
 }
})
