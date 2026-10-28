import { expect, test } from '@playwright/test'

// Browser interaction check with controlled API responses. Storage invariants are
// covered separately by console_optional_notes.test.sql and API contract tests.
test('routine monitoring saves need no explanation and show a compact history', async ({page}, info) => {
 const propertyId='11111111-1111-4111-8111-111111111119'
 let saved: Record<string,unknown>|null=null
 const config={id:propertyId,version:1,is_enabled:false,scrape_frequency:'weekly',radius_miles:4.5,max_competitors:20,auto_add:false,last_run_at:null,error_count:0,last_error:null}
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('/auth/login')
 await page.getByLabel('Email address').fill('local-admin@p11.test')
 await page.getByLabel('Password',{exact:true}).fill('local-dev-password')
 await page.getByRole('button',{name:'Sign in',exact:true}).click()
 await expect(page).not.toHaveURL(/auth\/login/)
 await page.route('**/api/properties',route=>route.fulfill({json:{properties:[{id:propertyId,name:'Console UX fixture',org_id:'22222222-2222-2222-2222-222222222222'}]}}))
 await page.route('**/api/marketvision/**',async route=>{
  const path=new URL(route.request().url()).pathname
  if(path.endsWith('/config')){
   if(route.request().method()==='PUT'){saved=route.request().postDataJSON();return route.fulfill({json:{success:true,result:{state:'saved'}}})}
   return route.fulfill({json:{config:saved?config:null,canManage:true}})
  }
  if(path.endsWith('/history'))return route.fulfill({json:{history:saved?[{id:propertyId,kind:'configuration.saved',reason:'No additional note.',createdAt:'2026-10-28T18:00:00Z',before:null,after:config,retainedPriceObservations:0}]:[],nextCursor:null}})
  if(path.endsWith('/runs'))return route.fulfill({json:{runs:[],counts:{all:0,attention:0,active:0,complete:0,closed:0,legacy:0},readAt:'2026-10-28T18:00:00Z',nextCursor:null,runtime:null}})
  if(path.endsWith('/refresh-status'))return route.fulfill({json:{paused:false,enabled:false,cadence:'manual',attempts:[],lastCompletedAt:null,latestObservationAt:null}})
  return route.fulfill({json:{profiles:[],competitors:[],alerts:[],stats:{},amenities:[]}})
 })
 await page.addInitScript(id=>localStorage.setItem('p11_selected_property_id',id),propertyId)
 await page.goto('/dashboard/marketvision?tab=monitoring')
 await page.getByRole('combobox',{name:'MarketVision tools'}).selectOption('monitoring')
 const save=page.getByRole('button',{name:'Save settings',exact:true})
 await expect(save).toBeEnabled()
 await expect(page.getByLabel('Note (optional)',{exact:true})).toBeHidden()
 await save.click()
 await expect(page.getByText('Monitoring settings saved',{exact:true})).toBeVisible()
 expect(saved).toMatchObject({propertyId,reason:''})
 const history=page.getByRole('region',{name:'Market change history'})
 await expect(history.getByRole('heading',{name:'Change history'})).toBeVisible()
 await expect(history.locator('ol > li')).toHaveCount(1)
 await expect(history).not.toContainText('Not previously saved')
 await expect(history).not.toContainText('→')
 await expect(history).not.toContainText('No additional note.')
 await history.scrollIntoViewIfNeeded()
 await page.screenshot({path:info.outputPath('compact-change-history.png')})
 await page.getByText('Add a note (optional)',{exact:true}).click()
 await expect(page.getByLabel('Note (optional)',{exact:true})).toBeVisible()
 expect(errors).toEqual([])
})
