import {beforeEach,expect,it,vi} from 'vitest'
import type {SupabaseClient} from '@supabase/supabase-js'
import type {Database} from '@/types/supabase'
const d=vi.hoisted(()=>({rpc:vi.fn(),config:vi.fn(),list:vi.fn(),read:vi.fn()}))
vi.mock('./google-calendar',async original=>({...await original<typeof import('./google-calendar')>(),getCalendarConfig:d.config}))
vi.mock('./calendar-binding-provider',()=>({listCalendarBindingCandidates:d.list,readCalendarBindingEvent:d.read}))
import {bindCalendarEvent as bind,calendarBindingSchema} from './tour-calendar-binding'
const db={rpc:d.rpc} as unknown as SupabaseClient<Database>
const input={action:'bind' as const,propertyId:'33333333-3333-3333-3333-333333333333',bookingId:'88888888-8888-4888-8888-888888888888',version:1,calendarId:'99999999-9999-4999-8999-999999999999',credentialVersion:7,providerEventId:'existing-event',requestId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',reason:'Confirmed this event with the team'}
const context={version:1,status:'confirmed',date:'2099-10-01',time:'10:00:00',duration:30,timezone:'UTC',bindingCount:0}
const remote={id:'existing-event',status:'confirmed',startDateTime:'2099-10-01T10:00:00.000Z',endDateTime:'2099-10-01T10:30:00.000Z'}
beforeEach(()=>{vi.resetAllMocks();d.config.mockResolvedValue({id:input.calendarId,credential_version:7,token_status:'healthy'});d.list.mockResolvedValue({events:[{...remote,title:'Tour'}],nextCursor:null});d.read.mockResolvedValue(remote);d.rpc.mockImplementation(async(name,args)=>({data:name==='tour_calendar_binding_context'?context:args.p_verified_at?{state:'applied',eventId:'saved',actionEventId:input.requestId}:{state:'verification_required'}}))})
it('recovers a lost saved link before touching the provider',async()=>{d.rpc.mockResolvedValue({data:{state:'replayed',eventId:'saved',actionEventId:input.requestId}});expect((await bind(db,'actor',input)).state).toBe('replayed');expect(d.config).not.toHaveBeenCalled();expect(d.read).not.toHaveBeenCalled()})
it('uses a fresh read and the selected credential revision',async()=>{expect((await bind(db,'actor',input)).state).toBe('applied');expect(d.rpc).toHaveBeenLastCalledWith('bind_tour_calendar_event',expect.objectContaining({p_remote:remote,p_credential_version:7,p_actor_id:'actor',p_verified_at:expect.any(String)}))})
it('lists only the saved booking interval',async()=>{expect(await bind(db,'actor',{action:'list',propertyId:input.propertyId,bookingId:input.bookingId,version:1})).toMatchObject({state:'listed',credentialVersion:7});expect(d.list).toHaveBeenCalledWith(expect.anything(),remote.startDateTime,remote.endDateTime,undefined)})
it('holds changed connections before reading the selected event',async()=>{d.config.mockResolvedValue({id:input.calendarId,credential_version:8,token_status:'healthy'});expect((await bind(db,'actor',input)).state).toBe('stale_connection');expect(d.read).not.toHaveBeenCalled()})
it('does not record a stale list selection after refresh changes its credential revision',async()=>{d.read.mockImplementation(async config=>{config.credential_version=8;return remote});expect((await bind(db,'actor',input)).state).toBe('stale_connection');expect(d.rpc.mock.calls.filter(c=>c[1].p_verified_at)).toHaveLength(0)})
it('keeps a provider outage from reaching the mutation',async()=>{d.read.mockRejectedValue(new Error('Provider down'));await expect(bind(db,'actor',input)).rejects.toThrow();expect(d.rpc.mock.calls.filter(c=>c[1].p_verified_at)).toHaveLength(0)})
it('requires both binding and action acknowledgments',async()=>{d.rpc.mockResolvedValue({data:{state:'applied'}});await expect(bind(db,'actor',input)).rejects.toThrow('could not be confirmed')})
it.each([{...input,actor:'forged'},{...input,remote},{...input,reason:''},{...input,credentialVersion:0},{...input,providerEventId:'bad id'}])('rejects untrusted input %j',value=>{expect(calendarBindingSchema.safeParse(value).success).toBe(false)})
