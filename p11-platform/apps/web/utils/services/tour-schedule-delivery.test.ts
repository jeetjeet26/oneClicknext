import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const d=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),paused:vi.fn(),calendar:vi.fn(),create:vi.fn(),update:vi.fn(),cancel:vi.fn(),email:vi.fn(),message:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:d.rpc,from:d.from})}))
vi.mock('./delivery-guard',()=>({isDeliveryPaused:d.paused}))
vi.mock('./google-calendar',()=>({getCalendarConfig:d.calendar,createCalendarEvent:d.create,updateCalendarEvent:d.update,cancelCalendarEvent:d.cancel}))
vi.mock('./messaging',()=>({sendEmail:d.email,sendMessage:d.message}))
afterEach(()=>vi.unstubAllEnvs())
import {processTourScheduleWork,withTourDelivery} from './tour-schedule-delivery'
const work={id:'job',property_id:'property',tour_source:'tour_bookings',tour_id:'tour',schedule_version:2,kind:'notice_email',lease_token:'token',dispatch:{to:'fixture@example.invalid',from:'fixture-sender@example.invalid',subject:'Pinned subject',body:'Pinned body'},payload:{action:'reschedule',date:'2099-01-01',time:'10:00:00',timezone:'UTC',durationMinutes:45,propertyName:'Fixture',name:'Guest',email:'fixture@example.invalid',phone:'+15550000000',calendarId:'calendar',providerCalendarId:'primary',provider:'google',eventId:'event'}}
const input={propertyId:'property',source:'tours' as const,tourId:'tour',version:2,kind:'reminder_24h' as const}
beforeEach(()=>{
 vi.stubEnv('RESEND_FROM_EMAIL','fixture-sender@example.invalid');vi.stubEnv('TELNYX_PHONE_NUMBER','+15550000001')
 vi.resetAllMocks();d.paused.mockReturnValue(false)
 const q={select:()=>q,in:()=>q,order:()=>q,eq:()=>q,maybeSingle:async()=>({data:{state:'superseded'}}),limit:vi.fn().mockResolvedValue({data:[{id:'job'}],error:null})};d.from.mockReturnValue(q)
 d.rpc.mockImplementation(async(name,args)=>({data:name==='pending_tour_schedule_work'?[{id:'job'}]:name==='start_tour_schedule_delivery'?{...work,dispatch:args.p_dispatch}:name.startsWith('claim_')?work:true,error:null}))
 d.email.mockResolvedValue({success:true,messageId:'email-receipt'});d.message.mockResolvedValue({success:true,messageId:'sms-receipt'})
 d.calendar.mockResolvedValue({id:'calendar',calendar_id:'primary',provider:'google',timezone:'UTC',token_status:'healthy'});d.update.mockResolvedValue({eventId:'event'});d.create.mockResolvedValue({eventId:'new-event'})
})
it('does not query or call providers while delivery is paused',async()=>{
 d.paused.mockReturnValue(true);const send=vi.fn();expect(await withTourDelivery(input,send)).toBe(false)
 expect((await processTourScheduleWork()).paused).toBe(true);expect(d.rpc).not.toHaveBeenCalled();expect(d.from).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled()
})
it('cannot send from a stale reminder snapshot',async()=>{
 d.rpc.mockResolvedValue({data:null,error:null});const send=vi.fn();expect(await withTourDelivery(input,send)).toBe(false);expect(send).not.toHaveBeenCalled()
 expect(d.rpc).toHaveBeenCalledWith('claim_tour_legacy_delivery',expect.objectContaining({p_version:2,p_kind:'reminder_24h'}))
})
it('holds a partial legacy send for review and never marks it completed',async()=>{
 const send=vi.fn().mockRejectedValue(new Error('Second channel acknowledgement lost'))
 await expect(withTourDelivery(input,send)).rejects.toThrow('Second channel')
 expect(d.rpc).toHaveBeenLastCalledWith('finish_tour_schedule_work',expect.objectContaining({p_success:false,p_token:'token'}))
})
it('requires a durable receipt before reporting legacy success',async()=>{
 d.rpc.mockImplementation(async(name)=>({data:name==='pending_tour_schedule_work'?[{id:'job'}]:name.startsWith('claim_')?work:false}))
 await expect(withTourDelivery(input,async()=>{})).rejects.toThrow('receipt could not be saved')
})
it('sends a versioned email only after claim and intent, then checkpoints acceptance',async()=>{
 expect(await processTourScheduleWork()).toMatchObject({succeeded:1,review:0})
 expect(d.email.mock.calls[0][6]).toBe('tour-change/job')
 expect(d.rpc.mock.calls.map(x=>x[0])).toEqual(['pending_tour_schedule_work','claim_tour_schedule_work','start_tour_schedule_delivery','finish_tour_schedule_work'])
 expect(d.rpc.mock.invocationCallOrder[2]).toBeLessThan(d.email.mock.invocationCallOrder[0])
 expect(d.rpc).toHaveBeenLastCalledWith('finish_tour_schedule_work',expect.objectContaining({p_success:true,p_receipt:{messageId:'email-receipt'}}))
})
it('does not send superseded work',async()=>{
 d.rpc.mockResolvedValue({data:null});expect((await processTourScheduleWork()).processed).toBe(0);expect(d.email).not.toHaveBeenCalled()
})
it('does not send after its claim expires',async()=>{
 d.rpc.mockImplementation(async(name)=>({data:name==='pending_tour_schedule_work'?[{id:'job'}]:name.startsWith('claim_')?work:name==='start_tour_schedule_delivery'?false:work}))
 expect((await processTourScheduleWork()).review).toBe(1);expect(d.email).not.toHaveBeenCalled()
})
it('holds ambiguous provider acceptance instead of automatically resending',async()=>{
 d.email.mockRejectedValue(new Error('response lost'));expect((await processTourScheduleWork()).review).toBe(1);expect(d.email).toHaveBeenCalledTimes(1)
 expect(d.rpc).toHaveBeenLastCalledWith('finish_tour_schedule_work',expect.objectContaining({p_success:false}))
})
it('holds a lost completion checkpoint',async()=>{
 d.rpc.mockImplementation(async(name,args)=>({data:name==='pending_tour_schedule_work'?[{id:'job'}]:name.startsWith('claim_')?work:name==='finish_tour_schedule_work'&&args.p_success?false:work}))
 expect((await processTourScheduleWork()).review).toBe(1);expect(d.email).toHaveBeenCalledTimes(1)
})
it('updates the pinned calendar event with the actual tour duration',async()=>{
 d.rpc.mockImplementation(async(name)=>({data:name==='pending_tour_schedule_work'?[{id:'job'}]:name.startsWith('claim_')?{...work,kind:'calendar'}:work}))
 expect((await processTourScheduleWork()).succeeded).toBe(1)
 expect(d.update).toHaveBeenCalledWith(expect.objectContaining({tour_duration_minutes:45}),'event',expect.objectContaining({tourTime:'10:00'}));expect(d.create).not.toHaveBeenCalled()
})
it('rejects a changed calendar destination before making a provider call',async()=>{
 d.rpc.mockImplementation(async(name)=>({data:name==='pending_tour_schedule_work'?[{id:'job'}]:name.startsWith('claim_')?{...work,kind:'calendar'}:work}));d.calendar.mockResolvedValue({id:'other',token_status:'healthy'})
 expect((await processTourScheduleWork()).review).toBe(1);expect(d.update).not.toHaveBeenCalled();expect(d.rpc.mock.calls.map(x=>x[0])).not.toContain('start_tour_schedule_delivery')
})
it('cancels only the pinned event',async()=>{
 d.rpc.mockImplementation(async(name)=>({data:name==='pending_tour_schedule_work'?[{id:'job'}]:name.startsWith('claim_')?{...work,kind:'calendar',payload:{...work.payload,action:'cancel'}}:work}))
 expect((await processTourScheduleWork()).succeeded).toBe(1);expect(d.cancel).toHaveBeenCalledWith(expect.anything(),'event')
})
it('creates an undelivered widget event using a stable schedule identity',async()=>{
 d.rpc.mockImplementation(async(name)=>({data:name==='pending_tour_schedule_work'?[{id:'job'}]:name.startsWith('claim_')?{...work,kind:'calendar',payload:{...work.payload,eventId:undefined}}:work}))
 expect((await processTourScheduleWork()).succeeded).toBe(1);expect(d.create).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({requestId:'tour-v2'}))
})
it('requires an SMS receipt',async()=>{
 d.rpc.mockImplementation(async(name)=>({data:name==='pending_tour_schedule_work'?[{id:'job'}]:name.startsWith('claim_')?{...work,kind:'notice_sms'}:work}));d.message.mockResolvedValue({success:true})
 expect((await processTourScheduleWork()).review).toBe(1)
})

it('reports newly held old work instead of reporting an empty successful run',async()=>{
 d.rpc.mockImplementation(async name=>({data:name==='pending_tour_schedule_work'?[{id:'job'}]:null}))
 const q={select:()=>q,in:()=>q,order:()=>q,eq:()=>q,limit:async()=>({data:[{id:'job'}]}),maybeSingle:async()=>({data:{state:'review'}})};d.from.mockReturnValue(q)
 expect((await processTourScheduleWork()).review).toBe(1);expect(d.email).not.toHaveBeenCalled()
})

it('uses saved message content and sender even if environment settings change',async()=>{
 vi.stubEnv('RESEND_FROM_EMAIL','changed@example.invalid')
 expect((await processTourScheduleWork()).succeeded).toBe(1)
 expect(d.email).toHaveBeenCalledWith('fixture@example.invalid','Pinned subject','Pinned body','fixture-sender@example.invalid',undefined,undefined,'tour-change/job')
})
it('recovers a lost success checkpoint with the same receipt and no second provider call',async()=>{
 let finishes=0
 d.rpc.mockImplementation(async(name)=>({data:name==='pending_tour_schedule_work'?[{id:'job'}]:name==='claim_tour_schedule_work'||name==='start_tour_schedule_delivery'?work:name==='finish_tour_schedule_work'?++finishes>1:true,error:name==='finish_tour_schedule_work'&&finishes===1?{message:'Lost reply'}:null}))
 expect((await processTourScheduleWork()).succeeded).toBe(1)
 expect(d.email).toHaveBeenCalledTimes(1)
 expect(d.rpc.mock.calls.filter(c=>c[0]==='finish_tour_schedule_work').every(c=>c[1].p_success&&c[1].p_receipt.messageId==='email-receipt')).toBe(true)
})
it('never overwrites known acceptance with a generic failure after checkpoint outage',async()=>{
 d.rpc.mockImplementation(async name=>({data:name==='pending_tour_schedule_work'?[{id:'job'}]:name==='claim_tour_schedule_work'||name==='start_tour_schedule_delivery'?work:false}))
 expect((await processTourScheduleWork()).review).toBe(1)
 expect(d.rpc.mock.calls.filter(c=>c[0]==='finish_tour_schedule_work').every(c=>c[1].p_success)).toBe(true)
 expect(d.email).toHaveBeenCalledTimes(1)
})
