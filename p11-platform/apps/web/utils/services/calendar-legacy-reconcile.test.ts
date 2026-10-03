import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const d=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),create:vi.fn(),update:vi.fn(),config:vi.fn(),bindingError:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:d.from,rpc:d.rpc})}))
vi.mock('./google-calendar',()=>({getCalendarConfig:d.config,createCalendarEvent:d.create,updateCalendarEvent:d.update}))
import {reconcileCalendarForProperty as reconcile} from './lumaleasing-calendar-reconcile'
let state:string|null=null
beforeEach(()=>{
 vi.resetAllMocks();vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','false');state=null
 d.config.mockResolvedValue({id:'calendar',property_id:'property',token_status:'healthy',tour_duration_minutes:30})
 d.create.mockResolvedValue({eventId:'event',htmlLink:'fixture-link'})
 d.rpc.mockImplementation(async name=>({data:name==='claim_tour_legacy_delivery'?{id:'claim',lease_token:'token'}:true}))
 d.from.mockImplementation((table:string)=>{
  let mode='read'
  const rows=()=>table==='properties'?{name:'Fixture'}:table==='tour_bookings'?[{id:'booking',lead_id:'lead',scheduled_date:'2099-01-01',scheduled_time:'10:00',schedule_version:1,duration_minutes:45}]:table==='leads'?[{id:'lead',email:'fixture@example.invalid'}]:table==='calendar_events'&&state?[{id:'binding',tour_booking_id:'booking',google_event_id:'event',sync_status:state}]:[]
  const result=()=>mode==='read'?{data:rows(),error:null}:{error:table==='calendar_events'?d.bindingError():null}
  const q={select:()=>q,eq:()=>q,in:()=>q,limit:async()=>result(),maybeSingle:async()=>result(),update:()=>{mode='write';return q},insert:async()=>{mode='write';return result()},then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(result()).then(resolve)}
  return q
 })
})
afterEach(()=>vi.unstubAllEnvs())
it.each(['external_drift','external_missing','external_cancelled','pending'])('never silently overwrites %s',async value=>{
 state=value;expect(await reconcile('property')).toMatchObject({skipped:1,created:0,repaired:0})
 expect(d.create).not.toHaveBeenCalled();expect(d.update).not.toHaveBeenCalled();expect(d.rpc).not.toHaveBeenCalled()
})
it('requires a saved binding before counting a created event',async()=>{
 d.bindingError.mockReturnValue(new Error('Binding unavailable'))
 expect(await reconcile('property')).toMatchObject({created:0,repaired:0,failed:1})
 expect(d.rpc).toHaveBeenLastCalledWith('finish_tour_schedule_work',expect.objectContaining({p_success:false}))
})
it('counts success only after the durable delivery checkpoint',async()=>{
 d.rpc.mockImplementation(async(name,args)=>({data:name==='claim_tour_legacy_delivery'?{id:'claim',lease_token:'token'}:!args.p_success}))
 expect(await reconcile('property')).toMatchObject({created:0,failed:1})
})
it('pins the legacy calendar request identity and uses booked duration',async()=>{
 expect(await reconcile('property')).toMatchObject({created:1,failed:0})
 expect(d.create).toHaveBeenCalledWith(expect.objectContaining({tour_duration_minutes:45}),expect.objectContaining({requestId:'booking-v1-legacy-calendar'}))
})
