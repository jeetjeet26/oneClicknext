import {actionHistoryDb} from '@/utils/actions/history'
import type {Database, Json} from '@/types/supabase'
import type {SupabaseClient} from '@supabase/supabase-js'
import {z} from 'zod'
import {createServiceClient} from '@/utils/supabase/admin'
import type {TourSource} from './tour-outcomes'

export const scheduleChangeSchema = z.object({
  tourId: z.string().uuid(), requestId: z.string().uuid(), expectedVersion: z.number().int().positive(),
  action: z.enum(['reschedule','cancel']), reason: z.string().trim().min(1).max(2000), notify: z.boolean().default(false),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const date=new Date(`${value}T00:00:00Z`);return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10)===value},'Choose a valid date.').optional(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
}).superRefine((data, ctx) => {
  if(data.action === 'reschedule' && (!data.date || !data.time)) ctx.addIssue({code:'custom',message:'Choose a date and time.'})
  if(data.action === 'cancel' && (data.date || data.time)) ctx.addIssue({code:'custom',message:'Cancellation must not change the time.'})
})
export type ScheduledTour = {id:string;status:string;tour_date:string;tour_time:string;schedule_version:number;duration_minutes:number;notes?:string|null}
export type ScheduleResult = {state:string;tour?:ScheduledTour;leadStatus?:string;changeId?:string;queued?:number;notificationRequested?:boolean}
export type ScheduleHistory = {reason:string;action:'reschedule'|'cancel';createdAt:string;delivery:'pending'|'review'|'complete'|'not_sent'|'none'}
export type ScheduleWork = {id:string;property_id:string;lead_id:string;tour_source:TourSource;tour_id:string;schedule_version:number;kind:string;state:string;lease_token:string;lease_until:string|null;attempts:number;started_at:string|null;receipt:Json|null;error_code:string|null;dispatch:{to:string;from:string;body:string;subject:string}|null;
  payload:{action:'reschedule'|'cancel';date:string;time:string;timezone:string|null;durationMinutes:number;propertyName:string;propertyAddress:string;name:string;email:string|null;phone:string|null;calendarId?:string;providerCalendarId?:string;provider?:string;eventId?:string}}
type SchedulingDatabase = Omit<Database,'public'> & {public:Omit<Database['public'],'Functions'|'Tables'> & {
 Functions:Database['public']['Functions'] & {
  change_tour_schedule:{Args:{p_property_id:string;p_lead_id:string;p_source:TourSource;p_tour_id:string;p_actor_id:string;p_request_id:string;p_expected_version:number;p_change:Json};Returns:Json}
  pending_tour_schedule_work:{Args:{p_limit?:number};Returns:Json}
  start_tour_schedule_delivery:{Args:{p_id:string;p_token:string;p_dispatch:Json};Returns:Json}
  review_tour_schedule_delivery:{Args:{p_property_id:string;p_lead_id:string;p_work_id:string;p_actor_id:string;p_request_id:string;p_input:Json};Returns:Json}
  claim_tour_schedule_work:{Args:{p_id:string};Returns:Json}
  claim_tour_legacy_delivery:{Args:{p_property_id:string;p_source:TourSource;p_tour_id:string;p_version:number;p_kind:string};Returns:Json}
  start_tour_schedule_work:{Args:{p_id:string;p_token:string};Returns:boolean}
  finish_tour_schedule_work:{Args:{p_id:string;p_token:string;p_receipt:Json;p_success:boolean};Returns:boolean}
 },Tables:Database['public']['Tables'] & {
  tour_schedule_reviews:{Row:{work_id:string;property_id:string;lead_id:string;input:{reason:string};created_at:string};Insert:never;Update:never;Relationships:[]}
  tour_schedule_changes:{Row:{tour_source:TourSource;tour_id:string;property_id:string;lead_id:string;input:Json;next_schedule:Json;created_at:string};Insert:never;Update:never;Relationships:[]}
  tour_schedule_work:{Row:ScheduleWork & {created_at:string};Insert:never;Update:never;Relationships:[]}
 }
}}
export const schedulingDb = (db:SupabaseClient<Database>) => db as unknown as SupabaseClient<SchedulingDatabase>
export async function changeTourSchedule(input:z.infer<typeof scheduleChangeSchema> & {propertyId:string;leadId:string;source:TourSource;actorId:string},db=createServiceClient()):Promise<ScheduleResult> {
 const {data,error}=await actionHistoryDb(db).rpc('apply_recorded_tour_action',{
  p_property_id:input.propertyId,p_lead_id:input.leadId,p_source:input.source,p_tour_id:input.tourId,p_actor_id:input.actorId,
  p_request_id:input.requestId,p_action:input.action==='cancel'?'tour.cancelled':'tour.rescheduled',
  p_input:{expectedVersion:input.expectedVersion,action:input.action,reason:input.reason,notify:input.notify,...(input.action==='reschedule'?{date:input.date!,time:input.time!}:{})},
 })
 if(error || !data) throw new Error('The change could not be confirmed. Retry the same request safely.')
 const result=data as unknown as ScheduleResult
 if(['applied','replayed'].includes(result.state) && (!result.tour?.id || !result.changeId)) throw new Error('The saved change could not be confirmed. Please retry.')
 return result
}
export function scheduleFailure(result:ScheduleResult) {
 const messages:Record<string,string>={
  calendar_review_required:'Review the external calendar change in LumaLeasing booking recovery before changing this tour.',
  stale:'This tour changed while you were editing. Close this form and refresh the tour history.',
  conflict:'Only an active tour can be rescheduled or cancelled. Refresh the tour history.',
  unavailable:'This time is no longer available. Choose another time.',
  unchanged:'Choose a different date or time.',needs_timezone:'Set the property timezone before rescheduling this tour.',
  ambiguous_time:'This local time is skipped or repeated by daylight saving. Choose another time.',not_future:'Choose a future date and time in the property timezone.',
  delivery_busy:'A tour message or calendar update is in progress. Wait for it to finish, then retry.',
  delivery_review_required:'An earlier delivery attempt needs review before the schedule can change. No changes were saved.',
  request_conflict:'This request was already used for another change. Refresh the tour history.',forbidden:'Forbidden',not_found:'Tour not found',
 }
 if(['applied','replayed'].includes(result.state)) return null
 if(!messages[result.state]) throw new Error('Unknown schedule change response')
 return {status:result.state==='forbidden'?403:result.state==='not_found'?404:409,error:messages[result.state]}
}
export async function getTourScheduleHistory(db:SupabaseClient<Database>,propertyId:string,leadId:string) {
 const durable=schedulingDb(db)
 const [changes,work]=await Promise.all([
  durable.from('tour_schedule_changes').select('tour_source,tour_id,input,next_schedule,created_at').eq('property_id',propertyId).eq('lead_id',leadId).order('created_at',{ascending:false}),
  durable.from('tour_schedule_work').select('tour_source,tour_id,state,kind,schedule_version').eq('property_id',propertyId).eq('lead_id',leadId).in('kind',['calendar','notice_email','notice_sms']).neq('state','superseded'),
 ])
 if(changes.error || work.error) throw new Error('Unable to load schedule history')
 const history=new Map<string,ScheduleHistory>()
 for(const change of changes.data || []) {
  const key=`${change.tour_source}/${change.tour_id}`;if(history.has(key))continue
  const input=change.input as {reason:string;action:'reschedule'|'cancel'}
  const tasks=(work.data || []).filter(w=>w.tour_source===change.tour_source && w.tour_id===change.tour_id && w.schedule_version===(change.next_schedule as {schedule_version:number}).schedule_version)
  history.set(key,{reason:input.reason,action:input.action,createdAt:change.created_at,
   delivery:tasks.some(w=>w.state==='review')?'review':tasks.some(w=>['queued','running'].includes(w.state))?'pending':tasks.some(w=>w.state==='skipped')?'not_sent':tasks.length?'complete':'none'})
 }
 return history
}
