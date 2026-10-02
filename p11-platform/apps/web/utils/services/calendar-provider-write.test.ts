import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const d=vi.hoisted(()=>({fetch:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:async(name:string,args:Record<string,unknown>)=>({data:name==='claim_calendar_token_refresh'?(args.p_force?{state:'claimed',refreshToken:'fixture'}:{state:'ready',permissionState:'confirmed',accessToken:'fixture',refreshToken:'fixture',expiresAt:'2099-01-01',version:1}):{state:'saved',permissionState:'confirmed',accessToken:(args.p_tokens as Record<string,string>).accessToken,refreshToken:'fixture',expiresAt:(args.p_tokens as Record<string,string>).expiresAt,version:2}}),from:()=>{
 const q={update:()=>q,eq:()=>q,insert:()=>q,then:(resolve:(value:unknown)=>void)=>resolve({error:null})};return q
}})}))
import {createCalendarEvent,updateCalendarEvent,cancelCalendarEvent,type CalendarConfig} from './google-calendar'
const config={credential_version:1,id:'calendar',property_id:'property',calendar_id:'fixture/calendar',provider:'google',access_token:'fixture',refresh_token:'fixture',token_expires_at:'2099-01-01',timezone:'America/New_York',tour_duration_minutes:30} as CalendarConfig
const details={propertyName:'Fixture',prospectName:'Fixture',prospectEmail:'fixture@example.invalid',tourDate:'2026-03-09',tourTime:'09:00'}
const ok=(body:unknown)=>({ok:true,json:async()=>body})
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',d.fetch);vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','false')})
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
for(const provider of ['google','microsoft'] as const) {
 for(const method of ['update','cancel'] as const) it(`bounds repeated ${provider} ${method} authorization failures`,async()=>{
  vi.stubEnv('GOOGLE_CLIENT_ID','fixture');vi.stubEnv('GOOGLE_CLIENT_SECRET','fixture');vi.stubEnv('MICROSOFT_CLIENT_ID','fixture');vi.stubEnv('MICROSOFT_CLIENT_SECRET','fixture');
  d.fetch.mockResolvedValueOnce({ok:false,status:401,text:async()=>''}).mockResolvedValueOnce(ok({access_token:'fresh',expires_in:3600})).mockResolvedValueOnce({ok:false,status:401,text:async()=>''})
  const call=method==='update'?updateCalendarEvent({...config,provider},'event/with+symbols',details):cancelCalendarEvent({...config,provider},'event/with+symbols')
  await expect(call).rejects.toThrow('401');expect(d.fetch).toHaveBeenCalledTimes(3)
  expect(d.fetch.mock.calls[0][0]).toContain('event%2Fwith%2Bsymbols');expect(d.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
 })
 it(`${provider} mutations respect the delivery pause before any provider access`,async()=>{
  vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','true')
  await expect(createCalendarEvent({...config,provider},details)).rejects.toThrow()
  await expect(updateCalendarEvent({...config,provider},'event',details)).rejects.toThrow()
  await expect(cancelCalendarEvent({...config,provider},'event')).rejects.toThrow()
  expect(d.fetch).not.toHaveBeenCalled()
 })
 it(`${provider} update requires the returned event identity`,async()=>{
  d.fetch.mockResolvedValue(ok({id:'different'}));await expect(updateCalendarEvent({...config,provider},'event',details)).rejects.toThrow('not confirmed')
 })
}
it('preserves UUID Google event identities and hashes compound request identities to valid stable IDs',async()=>{
 d.fetch.mockImplementation(async(_url,init)=>ok({...JSON.parse(init.body),htmlLink:'fixture'}))
 await createCalendarEvent(config,{...details,requestId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'})
 expect(JSON.parse(d.fetch.mock.calls[0][1].body).id).toBe('aaaaaaaabbbb4ccc8dddeeeeeeeeeeee')
 await createCalendarEvent(config,{...details,requestId:'booking-v1-legacy-calendar'})
 await createCalendarEvent(config,{...details,requestId:'booking-v1-legacy-calendar'})
 const id=JSON.parse(d.fetch.mock.calls[1][1].body).id;expect(id).toMatch(/^[0-9a-f]{64}$/);expect(JSON.parse(d.fetch.mock.calls[2][1].body).id).toBe(id)
})
it.each([false,true])('reconciles a Google conflict only when its identity and schedule match (changed=%s)',async changed=>{
 let saved:Record<string,unknown>={}
 d.fetch.mockImplementationOnce(async(_url,init)=>{saved=JSON.parse(init.body);return {ok:false,status:409}})
 d.fetch.mockImplementationOnce(async()=>ok({...saved,...(changed?{end:{dateTime:'2026-03-09T15:00:00Z'}}:{}),htmlLink:'fixture'}))
 const result=createCalendarEvent(config,{...details,requestId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'})
 if(changed)await expect(result).rejects.toThrow('needs review')
 else await expect(result).resolves.toMatchObject({eventId:'aaaaaaaabbbb4ccc8dddeeeeeeeeeeee'})
 expect(d.fetch).toHaveBeenCalledTimes(2)
})
