import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const d=vi.hoisted(()=>({fetch:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:async()=>({data:{state:'ready',permissionState:'confirmed',accessToken:'fixture-token',refreshToken:'fixture-refresh',expiresAt:'2099-01-01',version:1},error:null}),from:()=>{const q={update:()=>q,eq:async()=>({error:null})};return q}})}))
import {getCalendarEvent,createCalendarEvent,buildTourEventDateTimes,type CalendarConfig} from './google-calendar'
const config={credential_version:1,id:'calendar',property_id:'property',provider:'microsoft',calendar_id:'fixture/calendar',access_token:'fixture-token',refresh_token:'fixture-refresh',token_expires_at:'2099-01-01',timezone:'America/Chicago',tour_duration_minutes:30} as CalendarConfig
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',d.fetch)})
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
it('requests UTC Microsoft times and normalizes fractional seconds',async()=>{
 d.fetch.mockResolvedValue({ok:true,json:async()=>({id:'event',isCancelled:false,start:{dateTime:'2026-03-21T15:00:00.0000000',timeZone:'UTC'},end:{dateTime:'2026-03-21T15:30:00.0000000',timeZone:'UTC'}})})
 expect(await getCalendarEvent(config,'event/with+symbols')).toMatchObject({startDateTime:'2026-03-21T15:00:00.000Z',endDateTime:'2026-03-21T15:30:00.000Z'})
 expect(d.fetch).toHaveBeenCalledWith(expect.stringContaining('event%2Fwith%2Bsymbols'),expect.objectContaining({headers:expect.objectContaining({Prefer:'outlook.timezone="UTC"'})}))
})
it('keeps a read outage distinct from a deleted event',async()=>{
 d.fetch.mockResolvedValue({ok:false,status:503,text:async()=>''})
 await expect(getCalendarEvent(config,'event')).rejects.toThrow('503')
})
it.each([404,410])('reports explicit provider %s as missing',async status=>{d.fetch.mockResolvedValue({ok:false,status});expect(await getCalendarEvent(config,'event')).toBeNull()})
it('returns midnight as 00 rather than 24 in the next local day',()=>{
 expect(buildTourEventDateTimes({...config,timezone:'UTC'},'2026-03-21','23:30')).toEqual({startLocalDateTime:'2026-03-21T23:30:00',endLocalDateTime:'2026-03-22T00:00:00',startInstant:'2026-03-21T23:30:00.000Z',endInstant:'2026-03-22T00:00:00.000Z'})
})

it.each(['google','microsoft'] as const)('writes the exact end instant when a %s tour crosses the repeated DST hour',async provider=>{
 vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','false')
 d.fetch.mockResolvedValue({ok:true,json:async()=>({id:'event',htmlLink:'fixture',webLink:'fixture'})})
 await createCalendarEvent({...config,provider,timezone:'America/New_York',tour_duration_minutes:90},{propertyName:'Fixture',prospectName:'Fixture',prospectEmail:'fixture@example.invalid',tourDate:'2026-11-01',tourTime:'00:45'})
 const body=JSON.parse(d.fetch.mock.calls[0][1].body)
 expect(body.start.dateTime).toBe(provider==='microsoft'?'2026-11-01T04:45:00.000':'2026-11-01T04:45:00.000Z')
 expect(body.end.dateTime).toBe(provider==='microsoft'?'2026-11-01T06:15:00.000':'2026-11-01T06:15:00.000Z')
 expect(body.end.timeZone).toBe(provider==='microsoft'?'UTC':'America/New_York')
})
