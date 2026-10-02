import {expect,test} from '@playwright/test'
const url=process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:9430'
test.skip(!['localhost','127.0.0.1'].includes(new URL(url).hostname),'Local verification only')
test('partial consent returns visible recovery guidance without changing the connection',async({page},info)=>{
 await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/)
 const writes:string[]=[];page.on('request',request=>{if(request.url().includes('/api/lumaleasing/') && ['POST','PATCH','PUT','DELETE'].includes(request.method()))writes.push(request.url())})
 await page.goto('/dashboard/lumaleasing?error=permissions_incomplete&propertyId=33333333-3333-3333-3333-333333333333')
 await expect(page.getByText('Connection needs attention',{exact:true})).toBeVisible();await expect(page.getByText('Some required permissions were not granted.',{exact:false})).toBeVisible();await expect(page.locator('header select')).toHaveValue('33333333-3333-3333-3333-333333333333')
 await page.screenshot({path:info.outputPath('calendar-consent-recovery.png'),fullPage:true})
 await page.getByRole('button',{name:'Dismiss connection message'}).click();await expect(page.getByText('Connection needs attention',{exact:true})).toBeHidden();await expect(page).not.toHaveURL(/error=/);expect(writes).toHaveLength(0)
})
test('external authorizer gets a readable permission message on mobile',async({page},info)=>{
 await page.setViewportSize({width:390,height:844})
 await page.goto('/lumaleasing/integrations/success?error=permissions_unconfirmed&source=external_invite')
 await expect(page.getByRole('heading',{name:'We could not finish authorization'})).toBeVisible();await expect(page.getByText('The provider did not confirm the required permissions.',{exact:false})).toBeVisible();await expect(page.locator('body')).not.toContainText('permissions_unconfirmed')
 await page.screenshot({path:info.outputPath('calendar-consent-external-mobile.png'),fullPage:true})
 await page.goto('/lumaleasing/integrations/success?error=arbitrary-secret-from-query');await expect(page.locator('body')).not.toContainText('arbitrary-secret-from-query');await expect(page.getByText('The connection could not be confirmed.',{exact:false})).toBeVisible()
})
