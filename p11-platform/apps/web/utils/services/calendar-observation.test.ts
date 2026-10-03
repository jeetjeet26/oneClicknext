import {beforeEach,expect,it,vi} from 'vitest'
const d=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),remote:vi.fn(),config:vi.fn(),watch:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:d.from,rpc:d.rpc})}))
vi.mock('./google-calendar',async original=>({...await original<typeof import('./google-calendar')>(),getCalendarConfig:d.config,getCalendarEvent:d.remote,ensureCalendarWatch:d.watch}))
import {ingestExternalCalendarMutationsForProperty as ingest} from './lumaleasing-calendar-mutations'
const booking={id:'booking',property_id:'property',lead_id:'lead',scheduled_date:'2026-03-21',scheduled_time:'10:00:00',duration_minutes:45,status:'confirmed',schedule_version:2}
const event={id:'binding',tour_booking_id:'booking',agent_calendar_id:'calendar',google_event_id:'legacy-id',provider_event_id:'pinned-id',sync_status:'synced'}
beforeEach(()=>{
 vi.resetAllMocks();d.config.mockResolvedValue({id:'calendar',timezone:'America/Chicago',tour_duration_minutes:30,token_status:'healthy'})
 d.rpc.mockResolvedValue({data:'recorded'})
 d.remote.mockResolvedValue({id:'pinned-id',status:'confirmed',startDateTime:'2026-03-21T15:00:00.000Z',endDateTime:'2026-03-21T15:45:00.000Z'})
 d.from.mockImplementation((table:string)=>{
  const q={select:()=>q,eq:()=>q,in:()=>table==='calendar_events'?Promise.resolve({data:[event]}):q,limit:async()=>({data:[booking]})};return q
 })
})
it('compares instants and uses the booked duration rather than current calendar defaults',async()=>{
 expect(await ingest('property')).toMatchObject({checked:1,healthy:1,drifted:0,skipped:0})
 expect(d.remote).toHaveBeenCalledWith(expect.anything(),'pinned-id')
 expect(d.rpc).toHaveBeenCalledWith('record_tour_calendar_observation',expect.objectContaining({p_version:2,p_provider_event_id:'pinned-id',p_status:'synced'}))
})
it('does not count an obsolete provider response as a current observation',async()=>{d.rpc.mockResolvedValue({data:'stale'});expect(await ingest('property')).toMatchObject({checked:0,healthy:0,skipped:1})})
it('does not report success when observation persistence fails',async()=>{d.rpc.mockResolvedValue({error:new Error('Observation unavailable')});await expect(ingest('property')).rejects.toThrow('Observation unavailable')})
it('does not treat an unacknowledged observation as recorded',async()=>{d.rpc.mockResolvedValue({data:null});await expect(ingest('property')).rejects.toThrow('not confirmed')})
it('holds missing or malformed remote timing for review',async()=>{d.remote.mockResolvedValue({id:'pinned-id',status:'confirmed',startDateTime:null,endDateTime:null});expect(await ingest('property')).toMatchObject({drifted:1,healthy:0})})
it('does not read a binding on a different connected calendar',async()=>{
 d.from.mockImplementation((table:string)=>{const q={select:()=>q,eq:()=>q,in:()=>table==='calendar_events'?Promise.resolve({data:[{...event,agent_calendar_id:'other'}]}):q,limit:async()=>({data:[booking]})};return q})
 expect(await ingest('property')).toMatchObject({checked:0});expect(d.remote).not.toHaveBeenCalled()
})

it('preserves a pinned booking zone when current property settings use another zone',async()=>{
 d.config.mockResolvedValue({id:'calendar',timezone:'UTC',tour_duration_minutes:30,token_status:'healthy'})
 d.from.mockImplementation((table:string)=>{const q={select:()=>q,eq:()=>q,in:()=>table==='calendar_events'?Promise.resolve({data:[event]}):q,limit:async()=>({data:[{...booking,schedule_timezone:'America/Chicago'}]})};return q})
 expect(await ingest('property')).toMatchObject({checked:1,healthy:1,drifted:0})
})
