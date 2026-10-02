import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import type {BookLumaLeasingTourParams} from './lumaleasing-tour-booking'
const d=vi.hoisted(()=>({config:vi.fn(),busy:vi.fn(),slots:vi.fn(),rpc:vi.fn(),existing:vi.fn()}))
vi.mock('./google-calendar',()=>({getCalendarConfig:d.config,fetchBusyTimes:d.busy,generateAvailableSlots:d.slots}))
vi.mock('./phase-four-db',()=>({phaseFourDb:()=>({rpc:d.rpc})}))
import {bookLumaLeasingTour} from './lumaleasing-tour-booking'
const db={from:()=>{const q={select:()=>q,eq:()=>q,in:()=>q,maybeSingle:d.existing};return q}}
const params={supabase:db,propertyId:'property',propertyName:'Fixture',leadId:'lead',leadInfo:{email:'fixture@example.com'},bookingDate:'2026-03-09',bookingTime:'09:00',source:'lumaleasing',durationMinutes:30} as unknown as BookLumaLeasingTourParams
beforeEach(()=>{
 vi.resetAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date('2026-03-01T00:00:00Z'))
 d.existing.mockResolvedValue({data:null,error:null});d.config.mockResolvedValue({id:'calendar',calendar_id:'primary',provider:'google',timezone:'America/New_York',token_status:'healthy',tour_duration_minutes:45,buffer_minutes:15})
 d.busy.mockResolvedValue([]);d.slots.mockReturnValue([{time:'09:00',available:true}])
 d.rpc.mockImplementation(async(_name,args)=>({data:{booking:{id:'booking',scheduled_date:args.p_booking.scheduled_date,scheduled_time:args.p_booking.scheduled_time,status:'confirmed',duration_minutes:args.p_booking.duration_minutes},duplicate:false},error:null}))
})
afterEach(()=>vi.useRealTimers())
it('reserves the advertised duration and pins the property instant for delivery and downloads',async()=>{
 const result=await bookLumaLeasingTour(params);expect(result.ok).toBe(true)
 expect(d.rpc).toHaveBeenCalledWith('reserve_luma_tour',expect.objectContaining({p_booking:expect.objectContaining({duration_minutes:45}),p_delivery:expect.objectContaining({durationMinutes:45,timezone:'America/New_York',startsAt:'2026-03-09T13:00:00.000Z'})}))
 expect(d.busy.mock.calls[0].slice(1)).toEqual([new Date('2026-03-09T03:45:00Z'),new Date('2026-03-10T04:15:00Z')])
 if(result.ok)expect(new URL(result.calendar.google).searchParams.get('dates')).toBe('20260309T130000Z/20260309T134500Z')
})
it.each([['2026-03-08','02:30'],['2026-11-01','01:30'],['2026-02-28','09:00']])('rejects an invalid/past property instant even after a server availability check (%s %s)',async(bookingDate,bookingTime)=>{
 expect(await bookLumaLeasingTour({...params,bookingDate,bookingTime,skipAvailabilityCheck:true})).toMatchObject({ok:false,reason:'invalid_input'});expect(d.rpc).not.toHaveBeenCalled()
})
it('never reserves after a provider availability failure',async()=>{
 d.busy.mockRejectedValue(new Error('Availability unavailable'));await expect(bookLumaLeasingTour(params)).rejects.toThrow('unavailable');expect(d.rpc).not.toHaveBeenCalled()
})
