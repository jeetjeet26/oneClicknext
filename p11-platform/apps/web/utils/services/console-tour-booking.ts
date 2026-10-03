import {z} from 'zod'
import {actionHistoryDb} from '@/utils/actions/history'
import {createServiceClient} from '@/utils/supabase/admin'
export const consoleBookingSchema=z.object({
 requestId:z.string().uuid(),tourDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(`${v}T00:00:00Z`);return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v}),
 tourTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),tourType:z.enum(['in_person','virtual','self_guided']).default('in_person'),
 notes:z.string().trim().max(2000).nullable().optional(),sendConfirmation:z.boolean().default(true),assignedAgentId:z.string().uuid().nullable().optional(),
})
export type BookingContext={timezone:string|null;today:string|null;lastDate:string|null}
export type ConsoleBookingResult={state:string;tour?:{id:string;tour_date:string;tour_time:string;tour_type:string;status:string;schedule_version:number};leadStatus?:string;confirmation?:'queued'|'needs_contact'|'not_requested'|'accepted'|'review'|'not_sent';confirmationWorkId?:string|null;deliveryPaused?:boolean;actionEventId?:string}
export async function getBookingContext(db:ReturnType<typeof createServiceClient>,propertyId:string):Promise<BookingContext> {
 const {data,error}=await actionHistoryDb(db).rpc('tour_booking_context',{p_property_id:propertyId})
 if(error || !data)throw new Error('Booking timezone could not be loaded')
 return data as unknown as BookingContext
}
export async function bookConsoleTour(input:z.infer<typeof consoleBookingSchema>&{propertyId:string;leadId:string;actorId:string},db=createServiceClient()):Promise<ConsoleBookingResult> {
 const {data,error}=await actionHistoryDb(db).rpc('book_recorded_console_tour',{
  p_property_id:input.propertyId,p_lead_id:input.leadId,p_actor_id:input.actorId,p_request_id:input.requestId,
  p_input:{date:input.tourDate,time:input.tourTime,type:input.tourType,notes:input.notes||null,sendConfirmation:input.sendConfirmation,assignedAgentId:input.assignedAgentId||null},
 })
 if(error || !data)throw new Error('Booking could not be confirmed. Retry the same request safely.')
 const result=data as unknown as ConsoleBookingResult
 if(['applied','replayed'].includes(result.state)&&(!result.tour?.id||!result.actionEventId))throw new Error('Saved booking could not be confirmed. Retry the same request.')
 return result
}
export function bookingFailure(state:string) {
 const messages:Record<string,string>={needs_timezone:'Set the property timezone before booking.',ambiguous_time:'This time is skipped or repeated by a clock change. Choose another time.',not_future:'Choose a future time in the property timezone.',date_out_of_range:'Choose a date within the next 90 days.',invalid_agent:'Choose an agent from this organization.',unavailable:'This tour time is no longer available. Choose another time.',request_conflict:'This request was used for another booking. Close this form and refresh the tour history.',forbidden:'Forbidden',not_found:'Lead or booking not found'}
 if(['applied','replayed'].includes(state))return null
 if(!messages[state])throw new Error('Unknown booking response')
 return {error:messages[state],status:state==='forbidden'?403:state==='not_found'?404:409}
}

export type TourCalendarSchedule={timezone?:string|null;id:string;source:'tours'|'tour_bookings';startsAt:string|null;issue:string|null;durationMinutes:number}
export async function getTourCalendarSchedules(db:ReturnType<typeof createServiceClient>,propertyId:string,leadId:string) {
 const {data,error}=await actionHistoryDb(db).rpc('tour_calendar_schedules',{p_property_id:propertyId,p_lead_id:leadId})
 if(error||!Array.isArray(data))throw new Error('Tour calendar times could not be loaded')
 return new Map((data as unknown as TourCalendarSchedule[]).map(s=>[`${s.source}/${s.id}`,s]))
}
