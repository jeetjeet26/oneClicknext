import {beforeEach,expect,it,vi} from 'vitest'
import type {NextRequest} from 'next/server'
const d=vi.hoisted(()=>({calendar:{} as Record<string,unknown>}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'actor'}}})}})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:async()=>({authorized:true})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:async()=>({data:{state:'ready',summary:{total_events:0,synced_events:0,missing_event_bookings:0,degraded:false}},error:null}),from:(table:string)=>{
 const result={data:table==='agent_calendars'?d.calendar:[],error:null};const q={select:()=>q,eq:()=>q,is:()=>q,in:()=>q,maybeSingle:async()=>result,limit:async()=>result};return q
}})}))
import {GET} from './route'
const read=async()=>{const response=await GET(new Request('http://localhost/api/lumaleasing/calendar/status?propertyId=property') as NextRequest);expect(response.status).toBe(200);return response.json()}
beforeEach(()=>{d.calendar={id:'calendar',provider:'google',token_status:'healthy',sync_enabled:true,token_expires_at:'2099-01-01',scopes:['https://www.googleapis.com/auth/calendar','User.Read','Calendars.ReadWrite','Mail.Read','Mail.Send'],provider_metadata:{scopeEvidence:'provider_response'},timezone:null,properties:{settings:{}}}})
it.each([null,'','invalid'])('shows required setup for missing/invalid provider zone %s',async timezone=>{d.calendar.timezone=timezone;expect(await read()).toMatchObject({state:'setup_required',connected:false,timezone:null,timezone_setup_required:true,calendar_sync:{degraded:true}})})
it('uses the property timezone despite a missing provider zone',async()=>{d.calendar.properties={settings:{timezone:'Asia/Kolkata'}};expect(await read()).toMatchObject({state:'connected',timezone:'Asia/Kolkata',timezone_setup_required:false})})
it('does not fall back past an invalid explicit property timezone',async()=>{d.calendar.properties={settings:{timezone:'wrong'}};d.calendar.timezone='America/Chicago';expect(await read()).toMatchObject({state:'setup_required',timezone:null})})
it('shows both reauthorization and timezone setup when both are required',async()=>{d.calendar.token_status='error';expect(await read()).toMatchObject({state:'reconnect_required',timezone_setup_required:true})})
it('normalizes known Windows zones consistently with provider operations',async()=>{d.calendar.provider='microsoft';d.calendar.timezone='Pacific Standard Time';expect(await read()).toMatchObject({state:'connected',timezone:'America/Los_Angeles'})})

it.each([null,'invalid',''])('does not report connected for unverified credential expiry %j',async token_expires_at=>{d.calendar={...d.calendar,timezone:'UTC',token_expires_at};expect(await read()).toMatchObject({state:'reconnect_required',connected:false})})

it('does not require Google watch fields or claim automatic updates for Outlook',async()=>{d.calendar={...d.calendar,provider:'microsoft',timezone:'UTC',watch_expiration:'2099-01-01',watch_channel_id:'old-google-watch',watch_resource_id:'old-resource'};expect(await read()).toMatchObject({state:'connected',webhook_capability:{mode:'manual_check',ready:false,blockers:['automatic_updates_unavailable'],watch_expires_at:null,watch_ttl_minutes:null,watch_last_message_number:null}})})

it('keeps Outlook capability limits visible while renewal needs reconnection',async()=>{d.calendar={...d.calendar,provider:'microsoft',timezone:'UTC',token_status:'refresh_unconfirmed'};expect(await read()).toMatchObject({state:'reconnect_required',connected:false,webhook_capability:{mode:'manual_check',ready:false,blockers:['automatic_updates_unavailable','missing_calendar_connection'],watch_expires_at:null}})})
