import type {Database, Json} from '@/types/supabase'
import type {SupabaseClient} from '@supabase/supabase-js'
import {z} from 'zod'
import {buildTourEventDateTimes, getCalendarConfig, getCalendarEvent} from './google-calendar'

const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
export const calendarReviewSchema = z.discriminatedUnion('action', [
  z.object({action:z.literal('refresh'), propertyId:id, bookingId:id}).strict(),
  z.object({action:z.enum(['adopt','restore']), propertyId:id, bookingId:id, eventId:id, requestId:z.string().uuid(), version:z.number().int().positive(), observedAt:z.string().datetime({offset:true}), reason:z.string().trim().min(1).max(2000)}).strict(),
])
type Input = z.infer<typeof calendarReviewSchema>
type ReviewDatabase = Omit<Database,'public'> & {public:Omit<Database['public'],'Functions'> & {Functions:Database['public']['Functions'] & {
  tour_calendar_review_context:{Args:{p_property_id:string;p_booking_id:string};Returns:Json}
  review_tour_calendar_change:{Args:{p_property_id:string;p_booking_id:string;p_event_id:string;p_actor_id:string;p_request_id:string;p_version:number;p_observed_at:string;p_reason:string;p_verified_at?:string;p_verified_remote?:Json;p_verified_calendar?:Json;p_resolution?:string};Returns:Json}
  record_tour_calendar_observation:{Args:{p_property_id:string;p_calendar_id:string;p_event_id:string;p_booking_id:string;p_version:number;p_provider_event_id:string;p_read_started_at:string;p_status:string;p_remote:Json};Returns:string}
}}}
const reviewDb = (db:SupabaseClient<Database>) => db as unknown as SupabaseClient<ReviewDatabase>
type Context = {bookingId:string;version:number;status:string;date:string;time:string;duration:number;timezone:string|null;eventId:string;calendarId:string;providerEventId:string;syncStatus:string}
export type CalendarReviewResult = {state:string;actionEventId?:string;changeId?:string;action?:string;calendarId?:string;providerEventId?:string}
function checkedResult(data:unknown):CalendarReviewResult {
  if(!data || typeof data!=='object' || !('state' in data) || typeof data.state!=='string')throw new Error('Calendar decision could not be confirmed. Retry the same decision.')
  const result=data as CalendarReviewResult
  if(['applied','replayed'].includes(result.state) && (!result.actionEventId || !result.changeId))throw new Error('Calendar decision could not be confirmed. Retry the same decision.')
  return result
}
export async function reviewCalendarChange(db:SupabaseClient<Database>,actorId:string,input:Input):Promise<CalendarReviewResult> {
  const rpc=reviewDb(db)
  const args=input.action!=='refresh'?{p_property_id:input.propertyId,p_booking_id:input.bookingId,p_event_id:input.eventId,p_actor_id:actorId,p_request_id:input.requestId,p_version:input.version,p_observed_at:input.observedAt,p_reason:input.reason,p_resolution:input.action}:null
  if(args){
    // Recover a committed result before touching a provider; a lost response must be retryable during an outage.
    const probe=await rpc.rpc('review_tour_calendar_change',args)
    if(probe.error)throw probe.error
    const result=checkedResult(probe.data)
    if(result.state!=='verification_required')return result
  }
  const loaded=await rpc.rpc('tour_calendar_review_context',{p_property_id:input.propertyId,p_booking_id:input.bookingId})
  if(loaded.error)throw loaded.error
  if(!loaded.data)return {state:'not_found'}
  const context=loaded.data as unknown as Context
  if(!['scheduled','confirmed'].includes(context.status) || context.syncStatus==='pending')return {state:'conflict'}
  const config=await getCalendarConfig(input.propertyId)
  if(!config || config.id!==context.calendarId || config.token_status!=='healthy')return {state:'calendar_unavailable'}
  const verifiedAt=new Date().toISOString()
  const remote=await getCalendarEvent(config,context.providerEventId)
  if(remote && remote.id!==context.providerEventId)return {state:'binding_conflict'}
  if(args){
    const saved=await rpc.rpc('review_tour_calendar_change',{...args,p_verified_at:verifiedAt,p_verified_remote:remote as unknown as Json,p_verified_calendar:{id:config.id,provider:config.provider||'google',calendarId:config.calendar_id,accountEmail:config.account_email||config.google_email,credentialVersion:config.credential_version!}})
    if(saved.error)throw saved.error
    return checkedResult(saved.data)
  }
  let status='external_missing'
  if(remote){
    status=remote.status==='cancelled'?'external_cancelled':'external_drift'
    if(status==='external_drift' && context.timezone){
      const expected=buildTourEventDateTimes({timezone:context.timezone,tour_duration_minutes:context.duration},context.date,context.time.slice(0,5))
      if(remote.startDateTime===expected.startInstant && remote.endDateTime===expected.endInstant)status='synced'
    }
  }
  const saved=await rpc.rpc('record_tour_calendar_observation',{p_property_id:input.propertyId,p_calendar_id:context.calendarId,p_event_id:context.eventId,p_booking_id:input.bookingId,p_version:context.version,p_provider_event_id:context.providerEventId,p_read_started_at:verifiedAt,p_status:status,p_remote:remote as unknown as Json})
  if(saved.error)throw saved.error
  if(saved.data==='stale'||saved.data==='not_found')return {state:'stale'}
  if(saved.data!=='recorded')throw new Error('Calendar check could not be saved. Check again.')
  return {state:'refreshed'}
}
export const calendarReviewErrors:Record<string,{status:number;error:string}>={
 missing_recipient:{status:409,error:'Add an email address to this lead before restoring the calendar invitation.'},
 stale:{status:409,error:'This booking or calendar check changed. Reload the booking before deciding.'},
 provider_changed:{status:409,error:'The provider event changed again. Check the calendar again and review the latest details.'},
 conflict:{status:409,error:'This booking is no longer ready for this decision. Reload its current state.'},
 binding_conflict:{status:409,error:'The calendar connection or event identity changed. Check the connection before continuing.'},
 calendar_unavailable:{status:409,error:'Reconnect the calendar and complete its setup before reviewing changes.'},
 verification_expired:{status:409,error:'The calendar check expired. Retry the same decision to check it again.'},
 unsupported_change:{status:409,error:'Choose an event lasting 1–240 whole minutes with a precise start time. All-day and overnight changes need a different time.'},
 needs_timezone:{status:409,error:'This older booking needs a confirmed timezone before adopting a calendar move.'},
 not_found:{status:404,error:'No single calendar event was found for this booking.'},
 forbidden:{status:403,error:'You do not have access to this property.'},
 request_conflict:{status:409,error:'This request belongs to a different decision. Reload before continuing.'},
}
