import {expect,test} from '@playwright/test'
const propertyA='33333333-3333-3333-3333-333333333333'
const propertyB='44444444-4444-4444-4444-444444444444'
const base=process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000'
test.skip(!['localhost','127.0.0.1'].includes(new URL(base).hostname),'Local fixtures only')
const status=()=>({deliveryPaused:true,status:{requests:[],confirmations:[],audits:[],analysis:[],maintenance:[],reservedTokens:0}})
test.beforeEach(async({page})=>{
 await page.goto('/auth/login')
 await page.getByLabel('Email address').fill('local-admin@p11.test')
 await page.getByLabel('Password',{exact:true}).fill('local-dev-password')
 await page.getByRole('button',{name:'Sign in',exact:true}).click()
 await expect(page).not.toHaveURL(/\/auth\/login/)
})
test('reads actual local operations with authorization and no shared cache',async({page,request})=>{
 expect((await request.get(`/api/operations/reliability?propertyId=${propertyA}`)).status()).toBe(401)
 const response=await page.request.get(`/api/operations/reliability?propertyId=${propertyA}`)
 expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toBe('no-store')
 expect((await response.json()).status).toEqual(expect.objectContaining({requests:expect.any(Array),audits:expect.any(Array),maintenance:expect.any(Array)}))
 expect((await page.request.get('/api/operations/reliability?propertyId=99999999-9999-4999-8999-999999999999')).status()).toBe(403)
 await page.goto('/dashboard/lumaleasing')
 const panel=page.getByRole('region',{name:'Operational status'})
 await expect(panel.getByText('No recent items need attention.',{exact:false})).toBeVisible()
 await expect(page.getByText('+12%',{exact:true})).toHaveCount(0)
})
test('shows partial measurements and paused delivery at mobile width',async({page},info)=>{
 const fixture={...status(),status:{...status().status,audits:[{run_id:'audit',surface:'openai',state:'partial',coverage:{successful_executions:3,expected_executions:5}}],maintenance:[{kind:'knowledge',last_success_at:null,failures:1,next_attempt_at:'2099-01-01'}]}}
 await page.route('**/api/operations/reliability?*',route=>route.fulfill({json:fixture}))
 await page.setViewportSize({width:390,height:844})
 await page.goto('/dashboard/propertyaudit')
 const panel=page.getByRole('region',{name:'Operational status'})
 await expect(panel.getByText('openai: Incomplete measurement — 3 of 5 answers saved.')).toBeVisible()
 await expect(panel.getByText('Website knowledge: Refresh failed; retry scheduled.')).toBeVisible()
 expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
 await page.screenshot({path:info.outputPath('phase-four-operations-mobile.png')})
 await page.goto('/dashboard/lumaleasing')
 await expect(panel.getByText('External confirmations and follow-ups are paused.',{exact:false})).toBeVisible()
 await expect(page.getByRole('button',{name:'Configuration',exact:true})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await expect(page.getByText('Loading conversation records…')).toHaveCount(0)
 await page.screenshot({path:info.outputPath('phase-four-chatbot-mobile.png')})
})
test('recovers from an unavailable status without displaying a false healthy result',async({page})=>{
 let unavailable=true
 await page.route('**/api/operations/reliability?*',route=>unavailable?route.fulfill({status:503,json:{error:'offline'}}):route.fulfill({json:status()}))
 await page.goto('/dashboard/lumaleasing')
 const panel=page.getByRole('region',{name:'Operational status'})
 await expect(panel.getByRole('alert')).toBeVisible();await expect(panel.getByText('No recent items need attention.',{exact:false})).toHaveCount(0)
 unavailable=false;await panel.getByRole('button',{name:'Refresh status'}).click()
 await expect(panel.getByText('No recent items need attention.',{exact:false})).toBeVisible()
})
test('does not expose stale operation results after a property switch',async({page})=>{
 await page.route('**/api/properties',route=>route.fulfill({json:{properties:[{id:propertyA,name:'First community'},{id:propertyB,name:'Second community'}]}}))
 let settle:()=>void=()=>{};const settled=new Promise<void>(resolve=>{settle=resolve})
 await page.route('**/api/operations/reliability?*',async route=>{
  const first=new URL(route.request().url()).searchParams.get('propertyId')===propertyA
  if(first) await new Promise(resolve=>setTimeout(resolve,700))
  await route.fulfill({json:first?{...status(),status:{...status().status,requests:[{request_id:'FIRST-PRIVATE',operation:'lead',state:'review'}]}}:status()}).catch(()=>{})
  if(first) settle()
 })
 await page.goto('/dashboard/lumaleasing')
 await page.locator('header select').selectOption(propertyB)
 const panel=page.getByRole('region',{name:'Operational status'})
 await expect(panel.getByText('No recent items need attention.',{exact:false})).toBeVisible()
 await settled
 await expect(panel.getByText('FIRST-PR',{exact:false})).toHaveCount(0)
})
