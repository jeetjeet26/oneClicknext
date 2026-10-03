import {z} from 'zod'
import type {Database,Json} from '@/types/supabase'
import type {SupabaseClient} from '@supabase/supabase-js'
import {buildTourEventDateTimes,getCalendarConfig} from './google-calendar'
import {listCalendarBindingCandidates,readCalendarBindingEvent} from './calendar-binding-provider'
const id=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const common={propertyId:id,bookingId:id,version:z.number().int().positive()}
export const calendarBindingSchema=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('list'),cursor:z.string().max(8192).optional()}).strict(),
 z.object({...common,action:z.literal('bind'),requestId:z.string().uuid(),calendarId:id,credentialVersion:z.number().int().positive(),providerEventId:z.string().min(1).max(1024).regex(/^\S+$/),reason:z.string().trim().min(1).max(2000)}).strict(),
])
type BindingDatabase=Omit<Database,'public'>&{public:Omit<Database['public'],'Functions'>&{Functions:Database['public']['Functions']&{
 tour_calendar_binding_context:{Args:{p_property_id:string;p_booking_id:string};Returns:Json}
 bind_tour_calendar_event:{Args:{p_property_id:string;p_booking_id:string;p_actor_id:string;p_request_id:string;p_version:number;p_calendar_id:string;p_credential_version:number;p_provider_event_id:string;p_reason:string;p_verified_at?:string;p_remote?:Json};Returns:Json}
}}}
export type BindingResult={state:string;eventId?:string;actionEventId?:string}
const result=(data:unknown):BindingResult=>{if(!data||typeof data!=='object'||!('state' in data)||typeof data.state!=='string')throw new Error('Calendar link could not be confirmed. Retry the same selection.');const r=data as BindingResult;if(['applied','replayed'].includes(r.state)&&(!r.eventId||!r.actionEventId))throw new Error('Saved calendar link could not be confirmed. Retry the same selection.');return r}
export async function bindCalendarEvent(db:SupabaseClient<Database>,actor:string,input:z.infer<typeof calendarBindingSchema>){
 const rpc=db as unknown as SupabaseClient<BindingDatabase>
 const args=input.action==='bind'?{p_property_id:input.propertyId,p_booking_id:input.bookingId,p_actor_id:actor,p_request_id:input.requestId,p_version:input.version,p_calendar_id:input.calendarId,p_credential_version:input.credentialVersion,p_provider_event_id:input.providerEventId,p_reason:input.reason}:null
 if(args){const probe=await rpc.rpc('bind_tour_calendar_event',args);if(probe.error)throw probe.error;const r=result(probe.data);if(r.state!=='verification_required')return r}
 const loaded=await rpc.rpc('tour_calendar_binding_context',{p_property_id:input.propertyId,p_booking_id:input.bookingId});if(loaded.error)throw loaded.error
 if(!loaded.data)return {state:'not_found'}
 const context=loaded.data as unknown as {version:number;status:string;date:string;time:string;duration:number;timezone:string|null;bindingCount:number}
 if(context.version!==input.version)return {state:'stale'}
 if(context.bindingCount!==0)return {state:'binding_conflict'}
 if(!['scheduled','confirmed'].includes(context.status))return {state:'conflict'}
 if(!context.timezone)return {state:'needs_timezone'}
 const schedule=buildTourEventDateTimes({timezone:context.timezone,tour_duration_minutes:context.duration},context.date,context.time.slice(0,5))
 if(Date.parse(schedule.startInstant)<=Date.now())return {state:'not_future'}
 const config=await getCalendarConfig(input.propertyId);if(!config||config.token_status!=='healthy')return {state:'calendar_unavailable'}
 if(input.action==='list'){
  const candidates=await listCalendarBindingCandidates(config,schedule.startInstant,schedule.endInstant,input.cursor)
  return {state:'listed',...candidates,calendarId:config.id,credentialVersion:config.credential_version,timezone:context.timezone}
 }
 if(config.id!==input.calendarId||config.credential_version!==input.credentialVersion)return {state:'stale_connection'}
 const verifiedAt=new Date().toISOString(),remote=await readCalendarBindingEvent(config,input.providerEventId)
 if(config.credential_version!==input.credentialVersion)return {state:'stale_connection'}
 const saved=await rpc.rpc('bind_tour_calendar_event',{...args!,p_verified_at:verifiedAt,p_remote:remote as unknown as Json});if(saved.error)throw saved.error;return result(saved.data)
}
export const bindingMessages:Record<string,string>={not_found:'Booking not found.',stale:'This booking changed. Reload booking recovery.',binding_conflict:'This booking or event already has a calendar link. Reload booking recovery.',conflict:'Only an active booking can be linked.',needs_timezone:'Set the booking timezone before linking its event.',not_future:'Only a future booking can be linked.',calendar_unavailable:'Reconnect the calendar and grant its required permissions.',stale_connection:'The calendar connection changed. Reload matching events.',provider_changed:'The event no longer matches this booking. Reload matching events.',verification_expired:'The calendar check expired. Retry the same selection.',delivery_binding_conflict:'Earlier delivery uses a different calendar or schedule. Review that delivery before linking.',delivery_busy:'A delivery is in progress. Wait for it to finish.',delivery_review_required:'Review the uncertain delivery before linking a calendar event.',request_conflict:'This request belongs to a different selection. Reload booking recovery.',forbidden:'You do not have access to this property.'}
