import {beforeEach,expect,it,vi} from 'vitest'
import type {Database} from '@/types/supabase'
import type {SupabaseClient} from '@supabase/supabase-js'
const d=vi.hoisted(()=>({rpc:vi.fn(),config:vi.fn(),remote:vi.fn()}))
vi.mock('./google-calendar',async original=>({...await original<typeof import('./google-calendar')>(),getCalendarConfig:d.config,getCalendarEvent:d.remote}))
import {reviewCalendarChange as review,calendarReviewSchema} from './tour-calendar-review'
const db={rpc:d.rpc} as unknown as SupabaseClient<Database>
const property='33333333-3333-3333-3333-333333333333',booking='2f0081fa-f8dd-4a61-aabd-367b7919ba84'
const input={action:'adopt' as const,propertyId:property,bookingId:booking,eventId:'8fdee98e-0f8b-45a7-ae58-c5dc7988f26f',requestId:'257fe1be-73de-43bb-b05c-b97ae0d05c41',version:1,observedAt:'2026-09-16T10:00:00.123456+00:00',reason:'Checked with calendar'}
const context={bookingId:booking,calendarId:'calendar',providerEventId:'event',eventId:input.eventId,version:1,status:'confirmed',syncStatus:'external_drift',timezone:'America/Chicago',duration:30,date:'2026-09-20',time:'10:00:00'}
const remote={id:'event',status:'confirmed',startDateTime:'2026-09-20T16:00:00.000Z',endDateTime:'2026-09-20T16:30:00.000Z'}
beforeEach(()=>{
 vi.resetAllMocks()
 d.config.mockResolvedValue({id:'calendar',provider:'google',calendar_id:'provider-calendar',account_email:'calendar@example.invalid',token_status:'healthy',credential_version:7})
 d.remote.mockResolvedValue(remote)
 d.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>({data:name==='tour_calendar_review_context'?context:name==='record_tour_calendar_observation'?'recorded':args.p_verified_at?{state:'applied',changeId:'change',actionEventId:input.requestId,action:'reschedule'}:{state:'verification_required'}}))
})
it('rechecks the bound provider and passes exact observation plus calendar identity to the transaction',async()=>{
 expect(await review(db,'actor',input)).toMatchObject({state:'applied'})
 expect(d.remote).toHaveBeenCalledWith(expect.objectContaining({id:'calendar'}),'event')
 expect(d.rpc).toHaveBeenLastCalledWith('review_tour_calendar_change',expect.objectContaining({p_version:1,p_observed_at:input.observedAt,p_actor_id:'actor',p_verified_remote:remote,p_verified_calendar:{id:'calendar',provider:'google',calendarId:'provider-calendar',accountEmail:'calendar@example.invalid',credentialVersion:7}}))
})
it('recovers a saved decision without a provider read during an outage',async()=>{
 d.rpc.mockResolvedValue({data:{state:'replayed',changeId:'saved',actionEventId:input.requestId}})
 expect(await review(db,'actor',input)).toMatchObject({state:'replayed'});expect(d.config).not.toHaveBeenCalled();expect(d.remote).not.toHaveBeenCalled()
})
it('rejects stale chosen observation before querying a provider',async()=>{d.rpc.mockResolvedValue({data:{state:'stale'}});expect(await review(db,'actor',input)).toEqual({state:'stale'});expect(d.remote).not.toHaveBeenCalled()})
it('does not save a decision after a provider read fails',async()=>{d.remote.mockRejectedValue(new Error('Provider unavailable'));await expect(review(db,'actor',input)).rejects.toThrow('Provider unavailable');expect(d.rpc.mock.calls.filter(call=>call[1].p_verified_at)).toHaveLength(0)})
it.each([null,{id:'other',token_status:'healthy'},{id:'calendar',token_status:'expired'}])('holds unavailable or replaced connection %j',async config=>{d.config.mockResolvedValue(config);expect(await review(db,'actor',input)).toEqual({state:'calendar_unavailable'});expect(d.remote).not.toHaveBeenCalled()})
it('rejects a different returned provider event ID',async()=>{d.remote.mockResolvedValue({...remote,id:'other'});expect(await review(db,'actor',input)).toEqual({state:'binding_conflict'})})
it('does not treat an unacknowledged transaction as success',async()=>{d.rpc.mockResolvedValue({data:null});await expect(review(db,'actor',input)).rejects.toThrow('could not be confirmed')})
it('requires both saved action and schedule change acknowledgments',async()=>{d.rpc.mockResolvedValue({data:{state:'applied',actionEventId:input.requestId}});await expect(review(db,'actor',input)).rejects.toThrow('could not be confirmed')})
it.each([null,{...remote,status:'cancelled'}])('verifies removed provider event without creating a replacement %j',async event=>{d.remote.mockResolvedValue(event);await review(db,'actor',input);expect(d.rpc).toHaveBeenLastCalledWith('review_tour_calendar_change',expect.objectContaining({p_verified_remote:event}))})
it('refresh compares provider instants in the pinned zone',async()=>{
 d.remote.mockResolvedValue({...remote,startDateTime:'2026-09-20T15:00:00.000Z',endDateTime:'2026-09-20T15:30:00.000Z'})
 expect(await review(db,'actor',{action:'refresh',propertyId:property,bookingId:booking})).toEqual({state:'refreshed'})
 expect(d.rpc).toHaveBeenLastCalledWith('record_tour_calendar_observation',expect.objectContaining({p_status:'synced',p_version:1}))
})
it('refresh cannot publish an observation whose save was lost',async()=>{d.rpc.mockImplementation(async(name:string)=>({data:name==='tour_calendar_review_context'?context:null}));await expect(review(db,'actor',{action:'refresh',propertyId:property,bookingId:booking})).rejects.toThrow('could not be saved')})
it('accepts existing PostgreSQL property IDs and microsecond observation timestamps',()=>{expect(calendarReviewSchema.safeParse(input).success).toBe(true)})
it.each([{...input,reason:''},{...input,version:0},{...input,actorId:'spoofed'},{...input,verifiedRemote:remote},{...input,observedAt:'yesterday'}])('rejects invalid or browser-supplied trusted input %j',body=>{expect(calendarReviewSchema.safeParse(body).success).toBe(false)})

it('restoration requires the same fresh provider verification and a distinct resolution',async()=>{expect(calendarReviewSchema.safeParse({...input,action:'restore'}).success).toBe(true);await review(db,'actor',{...input,action:'restore'});expect(d.rpc).toHaveBeenLastCalledWith('review_tour_calendar_change',expect.objectContaining({p_resolution:'restore',p_verified_remote:remote,p_verified_calendar:expect.objectContaining({credentialVersion:7})}))})
