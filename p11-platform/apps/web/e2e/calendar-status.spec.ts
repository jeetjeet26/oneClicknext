import {expect,test} from '@playwright/test'
const baseURL=process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:9430'
test.skip(!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname),'Local console only')
test.beforeEach(async({page})=>{
 await page.goto('/auth/login');await page.getByLabel('Email address').fill('local-admin@p11.test');await page.getByLabel('Password',{exact:true}).fill('local-dev-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/auth\/login/)
})
test('calendar status failure shows retry rather than connection prompts or empty health',async({page},info)=>{
 let failed=true
 await page.route('**/api/lumaleasing/calendar/status?*',route=>route.fulfill(failed?{status:503,json:{error:'Fixture outage'}}:{json:{connected:false,state:'disconnected'}}))
 await page.goto('/dashboard/lumaleasing');await page.getByRole('button',{name:'Configuration',exact:true}).click();await page.getByRole('button',{name:'Tours',exact:true}).click()
 await expect(page.getByRole('button',{name:'Retry calendar status'})).toBeVisible()
 await expect(page.getByRole('button',{name:'Connect Google Calendar',exact:true})).toBeHidden()
 await expect(page.getByRole('button',{name:'Copy Google Calendar Link',exact:true})).toBeDisabled()
 await page.getByRole('button',{name:'Retry calendar status'}).scrollIntoViewIfNeeded()
 await page.screenshot({path:info.outputPath('calendar-status-unavailable.png'),fullPage:true})
 failed=false;await page.getByRole('button',{name:'Retry calendar status'}).click()
 await expect(page.getByRole('button',{name:'Connect Google Calendar',exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Retry calendar status'})).toBeHidden()
})
