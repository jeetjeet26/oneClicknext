import {beforeEach,it,expect,vi} from 'vitest'
const deps=vi.hoisted(()=>({rpc:vi.fn(),booking:vi.fn(),calendar:vi.fn(),create:vi.fn(),email:vi.fn(),paused:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:deps.rpc,from:()=>({select:()=>({eq:()=>({eq:()=>({single:deps.booking})})})})})}))
vi.mock('./google-calendar',()=>({getCalendarConfig:deps.calendar,createCalendarEvent:deps.create}))
vi.mock('./messaging',()=>({sendEmail:deps.email}))
vi.mock('./delivery-guard',()=>({isDeliveryPaused:deps.paused}))
vi.mock('./calendar-invite',()=>({generateTourCalendarResponse:()=>({icsAttachment:{filename:'tour.ics',content:'fixture'}})}))
import {processLumaDelivery} from './luma-delivery'
const job={schedule_version:1,id:'job',booking_id:'booking',property_id:'property',lease_token:'token',calendar_confirmed:false,email_confirmed:false,
 payload:{timezone:'America/New_York',startsAt:'2099-01-01T15:00:00.000Z',propertyName:'Fixture',propertyAddress:'Address',leadInfo:{email:'fixture@example.invalid'},calendarId:'calendar',providerCalendarId:'primary',provider:'google',bookingDate:'2099-01-01',bookingTime:'10:00',durationMinutes:30}}
beforeEach(()=>{
 vi.resetAllMocks();deps.paused.mockReturnValue(false)
 deps.booking.mockResolvedValue({data:{schedule_version:1,status:'confirmed',scheduled_date:'2099-01-01',scheduled_time:'10:00:00',duration_minutes:30},error:null})
 deps.calendar.mockResolvedValue({id:'calendar',calendar_id:'primary',provider:'google',timezone:'America/New_York',tour_duration_minutes:60,token_status:'healthy'})
 deps.create.mockResolvedValue({eventId:'event'});deps.email.mockResolvedValue({success:true,messageId:'receipt'})
 deps.rpc.mockImplementation(async(name)=>name==='claim_luma_delivery'?{data:job,error:null}:{data:true,error:null})
})
it('does not claim or send while delivery is paused',async()=>{
 deps.paused.mockReturnValue(true);expect((await processLumaDelivery(1)).paused).toBe(true)
 expect(deps.rpc).not.toHaveBeenCalled();expect(deps.create).not.toHaveBeenCalled();expect(deps.email).not.toHaveBeenCalled()
})
it('saves calendar receipt before sending, with stable provider identities',async()=>{
 expect((await processLumaDelivery(1)).succeeded).toBe(1)
 expect(deps.create).toHaveBeenCalledWith(expect.objectContaining({tour_duration_minutes:30}),expect.objectContaining({requestId:'booking'}))
 expect(deps.email.mock.calls[0][6]).toBe('luma-tour/booking')
 const stages=deps.rpc.mock.calls.filter(c=>c[0]==='save_luma_delivery').map(c=>c[1].p_stage)
 expect(stages).toEqual(['calendar','email'])
 expect(deps.rpc.mock.invocationCallOrder[1]).toBeLessThan(deps.email.mock.invocationCallOrder[0])
})
it('resumes after the calendar checkpoint without repeating the event',async()=>{
 deps.rpc.mockImplementation(async(name)=>name==='claim_luma_delivery'?{data:{...job,calendar_confirmed:true}}:{data:true})
 expect((await processLumaDelivery(1)).succeeded).toBe(1)
 expect(deps.create).not.toHaveBeenCalled();expect(deps.email).toHaveBeenCalledOnce()
})
it('does not email when a calendar acknowledgement is lost',async()=>{
 deps.rpc.mockImplementation(async(name,args)=>name==='claim_luma_delivery'?{data:job}:{data:args.p_stage!=='calendar'})
 expect((await processLumaDelivery(1)).failed).toBe(1);expect(deps.email).not.toHaveBeenCalled()
 expect(deps.rpc).toHaveBeenLastCalledWith('save_luma_delivery',expect.objectContaining({p_stage:'retry'}))
})
it('holds a changed reservation instead of sending an obsolete confirmation',async()=>{
 deps.booking.mockResolvedValue({data:{schedule_version:1,status:'confirmed',scheduled_date:'2099-01-02',scheduled_time:'10:00:00',duration_minutes:30}})
 expect((await processLumaDelivery(1)).failed).toBe(1);expect(deps.create).not.toHaveBeenCalled();expect(deps.email).not.toHaveBeenCalled()
 expect(deps.rpc).toHaveBeenLastCalledWith('save_luma_delivery',expect.objectContaining({p_stage:'review',p_receipt:{error:'booking_changed'}}))
})
it('holds changed calendar destinations',async()=>{
 deps.calendar.mockResolvedValue({id:'other',calendar_id:'primary',provider:'google',timezone:'America/New_York',tour_duration_minutes:60,token_status:'healthy'})
 await processLumaDelivery(1);expect(deps.create).not.toHaveBeenCalled()
 expect(deps.rpc).toHaveBeenLastCalledWith('save_luma_delivery',expect.objectContaining({p_stage:'review'}))
})
it('holds ambiguous Microsoft writes for reconciliation',async()=>{
 deps.rpc.mockImplementation(async(name)=>name==='claim_luma_delivery'?{data:{...job,payload:{...job.payload,provider:'microsoft'}}}:{data:true})
 deps.calendar.mockResolvedValue({id:'calendar',calendar_id:'primary',provider:'microsoft',timezone:'America/New_York',tour_duration_minutes:60,token_status:'healthy'})
 deps.create.mockRejectedValue(new Error('Connection lost after send'))
 await processLumaDelivery(1);expect(deps.email).not.toHaveBeenCalled()
 expect(deps.rpc).toHaveBeenLastCalledWith('save_luma_delivery',expect.objectContaining({p_stage:'review'}))
})
it('requires an email receipt before completion',async()=>{
 deps.email.mockResolvedValue({success:true})
 expect((await processLumaDelivery(1)).succeeded).toBe(0)
 expect(deps.rpc).toHaveBeenLastCalledWith('save_luma_delivery',expect.objectContaining({p_stage:'retry'}))
})

it('holds an old schedule version even when the displayed time happens to match again',async()=>{
 deps.booking.mockResolvedValue({data:{schedule_version:3,status:'confirmed',scheduled_date:'2099-01-01',scheduled_time:'10:00:00',duration_minutes:30}})
 expect((await processLumaDelivery(1)).failed).toBe(1);expect(deps.create).not.toHaveBeenCalled();expect(deps.email).not.toHaveBeenCalled()
})

it('holds legacy deliveries without a pinned timezone rather than guessing', async () => {
 deps.rpc.mockImplementation(async name => name === 'claim_luma_delivery' ? {data:{...job,payload:{...job.payload,timezone:undefined,startsAt:undefined}}} : {data:true})
 await processLumaDelivery(1);expect(deps.create).not.toHaveBeenCalled();expect(deps.email).not.toHaveBeenCalled()
 expect(deps.rpc).toHaveBeenLastCalledWith('save_luma_delivery',expect.objectContaining({p_stage:'review',p_receipt:{error:'booking_timezone_needs_review'}}))
})
it('holds a changed timezone even after the calendar was previously acknowledged', async () => {
 deps.rpc.mockImplementation(async name => name === 'claim_luma_delivery' ? {data:{...job,calendar_confirmed:true}} : {data:true})
 deps.calendar.mockResolvedValue({id:'calendar',calendar_id:'primary',provider:'google',timezone:'Asia/Kolkata',token_status:'healthy'})
 await processLumaDelivery(1);expect(deps.email).not.toHaveBeenCalled()
 expect(deps.rpc).toHaveBeenLastCalledWith('save_luma_delivery',expect.objectContaining({p_stage:'review'}))
})

it('accepts the database timestamp encoding of the same pinned instant',async()=>{
 deps.rpc.mockImplementation(async name=>name==='claim_luma_delivery'?{data:{...job,payload:{...job.payload,startsAt:'2099-01-01T15:00:00+00:00'}}}:{data:true})
 expect((await processLumaDelivery(1)).succeeded).toBe(1)
})
