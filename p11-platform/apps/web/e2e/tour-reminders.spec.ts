import {expect, test as base} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430'
const databaseURL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const local = ['localhost','127.0.0.1']
const createFixtureClient = () => createClient(databaseURL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
base.skip(!local.includes(new URL(baseURL).hostname), 'Local fixtures only')
const test = base.extend<{fixture: {property: string; lead: string; tour: string; db: ReturnType<typeof createFixtureClient>; date: string;job:string;token:string;email:string;sms:string}}>({
  fixture: async ({}, provideFixture) => {
    if (!databaseURL || !local.includes(new URL(databaseURL).hostname)) throw new Error('A local database is required')
    const db=createFixtureClient()
    const property=randomUUID(), lead=randomUUID(), tour=randomUUID()
    const starts=new Date(Date.now()+24*3600000);const date=starts.toISOString().slice(0,10),time=starts.toISOString().slice(11,19)
    async function save(query: PromiseLike<{error: unknown}>) {const result=await query; if(result.error) throw result.error}
    try {
      await save(db.from('properties').insert({id:property,name:'Reminder recovery browser fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{timezone:'UTC'}}))
      await save(db.from('leads').insert({id:lead,property_id:property,first_name:'Reminder',last_name:'Fixture',email:'reminder@example.invalid',phone:'+15550000000',source:'manual',status:'tour_booked'}))
      await save(db.from('tours').insert({id:tour,property_id:property,lead_id:lead,tour_date:date,tour_time:time,status:'confirmed'}))
      const prepared=await db.rpc('prepare_tour_reminder',{p_property_id:property,p_source:'tours',p_tour_id:tour,p_version:1,p_kind:'reminder_24h'})
      if(prepared.error)throw prepared.error
      const job=prepared.data.id,token=prepared.data.lease_token
      const email=prepared.data.channels.find((c:{channel:string})=>c.channel==='email').id,sms=prepared.data.channels.find((c:{channel:string})=>c.channel==='sms').id
      await save(db.rpc('start_tour_reminder_channel',{p_id:email,p_token:token,p_body:'Local email fixture',p_subject:'Local fixture',p_sender:'fixture@example.invalid'}))
      await save(db.rpc('finish_tour_reminder_channel',{p_id:email,p_token:token,p_provider_id:'fixture-email-receipt'}))
      await save(db.rpc('start_tour_reminder_channel',{p_id:sms,p_token:token,p_body:'Local SMS fixture',p_subject:null,p_sender:'+15550000001'}))
      await save(db.rpc('finish_tour_reminder_channel',{p_id:sms,p_token:token,p_provider_id:null}))
      await save(db.rpc('settle_tour_reminder',{p_id:job,p_token:token}))
      await provideFixture({property,lead,tour,db,date,job,token,email,sms})
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
async function openTour(page: import('@playwright/test').Page,property:string) {
 await page.goto('/dashboard/leads');await page.locator('header select').selectOption(property)
 await page.getByText('Reminder Fixture',{exact:true}).click();await page.getByRole('button',{name:/^Tours/}).click()
}

test('displays separate receipts and saves an auditable provider review through reload',async({page,fixture},info)=>{
 await openTour(page,fixture.property)
 await page.getByRole('button',{name:/Tour message delivery/}).click()
 const history=page.getByRole('region',{name:'Tour message delivery'})
 await expect(history.getByText('Accepted by provider',{exact:true})).toHaveCount(1)
 await expect(history.getByText('Needs review',{exact:true})).toHaveCount(1)
 const form=page.getByRole('form',{name:'Review text reminder'})
 await form.getByLabel('Provider message ID').fill('fixture-confirmed-sms')
 await form.getByLabel('Review evidence').fill('Checked local provider fixture; message was accepted.')
 await form.getByRole('button',{name:'Save delivery review'}).click()
 await expect(history.getByText('Accepted by provider',{exact:true})).toHaveCount(2)
 await page.reload();await page.getByText('Reminder Fixture',{exact:true}).click();await page.getByRole('button',{name:/^Tours/}).click();await page.getByRole('button',{name:/Tour message delivery/}).click()
 await expect(page.getByText('Message ID: fixture-confirmed-sms')).toBeVisible()
 await expect(page.getByText('Review: Checked local provider fixture; message was accepted.')).toBeVisible()
 await page.screenshot({path:info.outputPath('reminder-history-desktop.png')})
 expect((await fixture.db.from('tour_schedule_work').select('state').eq('id',fixture.job).single()).data!.state).toBe('completed')
 expect((await fixture.db.from('tours').select('reminder_24h_sent_at').eq('id',fixture.tour).single()).data!.reminder_24h_sent_at).toBeTruthy()
 expect((await fixture.db.from('tour_reminder_reviews').select('id').eq('property_id',fixture.property)).data).toHaveLength(1)
})
test('mobile lost-response retry requeues only the confirmed unsent channel',async({page,fixture},info)=>{
 await page.setViewportSize({width:390,height:844});await openTour(page,fixture.property);await page.getByRole('button',{name:/Tour message delivery/}).click()
 const form=page.getByRole('form',{name:'Review text reminder'})
 await form.getByLabel('Provider outcome').selectOption('not_sent');await form.getByLabel('Review evidence').fill('Local fixture confirms no SMS was accepted.')
 let first=true;const ids:string[]=[]
 await page.route('**/api/tours/reminders/recovery',async route=>{
  if(route.request().method()!=='POST'){await route.continue();return}
  ids.push(route.request().postDataJSON().requestId)
  if(first){first=false;expect((await route.fetch()).status()).toBe(200);await route.abort('failed');return}await route.continue()
 })
 await form.getByRole('button',{name:'Save delivery review'}).click();await expect(form.getByRole('status')).toContainText('unconfirmed')
 await page.screenshot({path:info.outputPath('reminder-review-mobile-retry.png')})
 await form.getByRole('button',{name:'Save delivery review'}).click()
 await expect(page.getByRole('region',{name:'Tour message delivery'}).getByText('Queued',{exact:true})).toBeVisible()
 expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1])
 const rows=(await fixture.db.from('tour_reminder_channels').select('channel,state,attempts,provider_id').eq('work_id',fixture.job)).data!
 expect(rows.find(c=>c.channel==='email')).toMatchObject({state:'accepted',attempts:1,provider_id:'fixture-email-receipt'})
 expect(rows.find(c=>c.channel==='sms')).toMatchObject({state:'queued',attempts:1,provider_id:null})
 expect((await fixture.db.from('tour_reminder_reviews').select('id').eq('property_id',fixture.property)).data).toHaveLength(1)
 expect((await fixture.db.rpc('finish_tour_reminder_channel',{p_id:fixture.sms,p_token:fixture.token,p_provider_id:'stale-worker'})).data).toBe(false)
})
test('real review API enforces authentication and one winner for concurrent decisions',async({page,request,fixture})=>{
 const body={leadId:fixture.lead,channelId:fixture.sms,requestId:randomUUID(),resolution:'accepted',reason:'Provider fixture checked',providerId:'fixture-sms-concurrent'}
 expect((await request.post(`${baseURL}/api/tours/reminders/recovery`,{data:body})).status()).toBe(401)
 const responses=await Promise.all([page.request.post('/api/tours/reminders/recovery',{data:body}),page.request.post('/api/tours/reminders/recovery',{data:{...body,requestId:randomUUID()}})])
 expect(responses.map(r=>r.status()).sort()).toEqual([200,409])
 expect((await fixture.db.from('tour_reminder_reviews').select('id').eq('property_id',fixture.property)).data).toHaveLength(1)
 expect((await page.request.get(`/api/tours/reminders/recovery?leadId=${fixture.lead}`)).status()).toBe(200)
 expect((await page.request.post('/api/tours/reminders/recovery',{data:{...body,leadId:randomUUID(),requestId:randomUUID()}})).status()).toBe(404)
 const history=await (await page.request.get(`/api/tours/reminders/recovery?leadId=${fixture.lead}`)).json()
 expect(JSON.stringify(history)).not.toContain('lease_token')
})
