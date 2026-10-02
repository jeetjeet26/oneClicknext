import {expect, test as base} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430'
const databaseURL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const local = ['localhost','127.0.0.1']
const createFixtureClient = () => createClient(databaseURL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
base.skip(!local.includes(new URL(baseURL).hostname), 'Local fixtures only')
const test = base.extend<{fixture: {property: string; lead: string; tour: string; db: ReturnType<typeof createFixtureClient>; date: string}}>({
  fixture: async ({}, provideFixture) => {
    if (!databaseURL || !local.includes(new URL(databaseURL).hostname)) throw new Error('A local database is required')
    const db=createFixtureClient()
    const property=randomUUID(), lead=randomUUID(), tour=randomUUID()
    const date=new Date(Date.now()-86400000).toISOString().slice(0,10)
    async function save(query: PromiseLike<{error: unknown}>) {const result=await query; if(result.error) throw result.error}
    try {
      await save(db.from('properties').insert({id:property,name:'No-show recovery browser fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{timezone:'UTC'}}))
      await save(db.from('leads').insert({id:lead,property_id:property,first_name:'Outcome',last_name:'Fixture',email:'tour-outcome@example.invalid',source:'manual',status:'tour_booked'}))
      await save(db.from('tours').insert({id:tour,property_id:property,lead_id:lead,tour_date:date,tour_time:'10:00',status:'confirmed'}))
      await save(db.from('workflow_definitions').insert({property_id:property,name:'Local outcome follow-up',trigger_on:'tour_completed',steps:[{action:'email',template_slug:'local-only',delay_hours:8760}],exit_conditions:['leased','lost']}))
      await provideFixture({property,lead,tour,db,date})
    } finally {
      await save(db.from('leads').delete().eq('id',lead))
      execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
      expect((await db.from('properties').select('id').eq('id',property)).data).toHaveLength(0)
    }
  },
})
test.beforeEach(async ({page}) => {
  await page.goto('/auth/login')
  await page.getByLabel('Email address').fill('local-admin@p11.test')
  await page.getByLabel('Password',{exact:true}).fill('local-dev-password')
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await expect(page).not.toHaveURL(/\/auth\/login/)
})
async function openTour(page: import('@playwright/test').Page, property: string) {
  await page.goto('/dashboard/leads')
  await page.locator('header select').selectOption(property)
  await page.getByText('Outcome Fixture',{exact:true}).click()
  await page.getByRole('button',{name:/^Tours/}).click()
  await page.getByRole('button',{name:'Record outcome',exact:true}).click()
}
test('an exhausted automatic attempt is visible and can be resolved with a verified outcome',async({page,fixture},info)=>{
 const inserted=await fixture.db.from('tour_noshow_attempts').insert({property_id:fixture.property,lead_id:fixture.lead,tour_source:'tours',tour_id:fixture.tour,schedule_version:1,state:'review',attempts:3,error_code:'outcome_transaction_failed'})
 expect(inserted.error).toBeNull()
 await openTour(page,fixture.property)
 await expect(page.getByText('Tour needs review',{exact:true})).toBeVisible()
 await expect(page.getByText('Automatic processing stopped after repeated failures.',{exact:false})).toBeVisible()
 await page.screenshot({path:info.outputPath('noshow-review-desktop.png')})
 await page.getByLabel('Outcome notes (optional)').fill('Attendance verified with the leasing agent.')
 await page.getByRole('button',{name:'Save outcome',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Tour outcome saved.'})).toBeVisible()
 await expect(page.getByText('Tour needs review',{exact:true})).toHaveCount(0)
 await page.reload();await page.getByText('Outcome Fixture',{exact:true}).click();await page.getByRole('button',{name:/^Tours/}).click()
 await expect(page.getByText('Completed',{exact:true})).toBeVisible()
 await expect(page.getByText('Tour needs review',{exact:true})).toHaveCount(0)
 expect((await fixture.db.from('tour_noshow_attempts').select('attempts').eq('tour_id',fixture.tour).single()).data?.attempts).toBe(3)
})
test('old tours require a decision and do not launch a fresh no-show campaign',async({page,fixture},info)=>{
 await page.setViewportSize({width:390,height:844})
 const removed=await fixture.db.from('tours').delete().eq('id',fixture.tour);expect(removed.error).toBeNull()
 const old=new Date(Date.now()-10*86400000).toISOString().slice(0,10)
 expect((await fixture.db.from('tours').insert({id:fixture.tour,property_id:fixture.property,lead_id:fixture.lead,tour_date:old,tour_time:'09:00',status:'confirmed'})).error).toBeNull()
 await openTour(page,fixture.property)
 await expect(page.getByText('This tour is over seven days old.',{exact:false})).toBeVisible()
 await page.screenshot({path:info.outputPath('noshow-backlog-mobile.png')})
 await page.getByLabel('Tour outcome',{exact:true}).selectOption('no_show')
 await page.getByRole('button',{name:'Save outcome',exact:true}).click()
 await expect(page.getByText('Follow-ups were held because the tour timing or current lead state is not eligible.',{exact:false})).toBeVisible()
 expect((await fixture.db.from('lead_workflows').select('id').eq('lead_id',fixture.lead)).data).toHaveLength(0)
 expect((await fixture.db.from('tour_outcomes').select('followup_state').eq('tour_id',fixture.tour).single()).data?.followup_state).toBe('suppressed')
})
