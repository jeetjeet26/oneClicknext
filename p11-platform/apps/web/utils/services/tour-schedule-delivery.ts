import type {Json} from '@/types/supabase'
import {createServiceClient} from '@/utils/supabase/admin'
import {isDeliveryPaused} from './delivery-guard'
import {schedulingDb,type ScheduleWork} from './tour-scheduling'
import type {TourSource} from './tour-outcomes'
import {getCalendarConfig,createCalendarEvent,updateCalendarEvent,cancelCalendarEvent} from './google-calendar'
import {sendEmail,sendMessage} from './messaging'

/** A legacy sender keeps a claim until its whole attempt is confirmed or held for review. */
export async function withTourDelivery(input:{propertyId:string;source:TourSource;tourId:string;version:number;kind:'confirmation'|'reminder_24h'|'reminder_1h'|'calendar_reconcile'},send:()=>Promise<void>,db=createServiceClient()) {
 if(isDeliveryPaused()) return false
 const durable=schedulingDb(db)
 const claim=await durable.rpc('claim_tour_legacy_delivery',{p_property_id:input.propertyId,p_source:input.source,p_tour_id:input.tourId,p_version:input.version,p_kind:input.kind})
 if(claim.error) throw new Error('Could not claim the tour delivery')
 if(!claim.data) return false
 const work=claim.data as unknown as ScheduleWork
 const finish=async(success:boolean) => {
  const saved=await durable.rpc('finish_tour_schedule_work',{p_id:work.id,p_token:work.lease_token,p_success:success,p_receipt:success?{legacySenderConfirmed:true}:{error:'delivery_unconfirmed'}})
  if(saved.error || !saved.data) throw new Error('Tour delivery receipt could not be saved; review before retrying.')
 }
 try {await send();await finish(true);return true} catch(error) {await finish(false);throw error}
}
export async function processTourScheduleWork(limit=10) {
 const result={processed:0,succeeded:0,review:0,paused:isDeliveryPaused()}
 if(result.paused) return result
 const db=createServiceClient(),durable=schedulingDb(db)
 const due=await durable.rpc('pending_tour_schedule_work',{p_limit:Math.max(1,Math.min(limit,20))})
 if(due.error) throw new Error('Unable to load tour updates')
 for(const candidate of (due.data || []) as {id:string}[]) {
  const claimed=await durable.rpc('claim_tour_schedule_work',{p_id:candidate.id})
  if(claimed.error) throw new Error('Unable to claim tour update')
  if(!claimed.data){
   const held=await durable.from('tour_schedule_work').select('state').eq('id',candidate.id).maybeSingle()
   if(held.error)throw new Error('Unable to confirm skipped tour update')
   if(held.data?.state==='review')result.review++
   continue
  }
  const work=claimed.data as unknown as ScheduleWork,p=work.payload
  result.processed++
  const start=async(dispatch:Json={})=>{const r=await durable.rpc('start_tour_schedule_delivery',{p_id:work.id,p_token:work.lease_token,p_dispatch:dispatch});if(r.error || !r.data)throw new Error('Tour update claim expired');return r.data as unknown as ScheduleWork}
  const finish=async(success:boolean,receipt:Json)=>{
   for(let attempt=0;attempt<2;attempt++) {
    const r=await durable.rpc('finish_tour_schedule_work',{p_id:work.id,p_token:work.lease_token,p_success:success,p_receipt:receipt})
    if(!r.error&&r.data)return
   }
   throw new Error('Tour update receipt was not saved')
  }
  let receipt:Json|null=null
  try {
   if(work.kind==='calendar') {
    const calendar=await getCalendarConfig(work.property_id)
    if(!calendar || calendar.token_status!=='healthy' || calendar.id!==p.calendarId || calendar.calendar_id!==p.providerCalendarId || calendar.provider!==p.provider || calendar.timezone!==p.timezone)throw new Error('Calendar connection needs review')
    const config={...calendar,tour_duration_minutes:p.durationMinutes}
    if(p.action==='cancel'&&!p.eventId)throw new Error('Calendar event identity is missing')
    if(p.action!=='cancel'&&!p.email)throw new Error('Prospect email is missing')
    await start()
    if(p.action==='cancel') {
     if(!p.eventId)throw new Error('Calendar event identity is missing')
     await cancelCalendarEvent(config,p.eventId);receipt={eventId:p.eventId,cancelled:true}
    } else {
     if(!p.email)throw new Error('Prospect email is missing')
     const details={propertyName:p.propertyName,propertyAddress:p.propertyAddress,prospectName:p.name || 'Guest',prospectEmail:p.email,prospectPhone:p.phone || undefined,tourDate:p.date,tourTime:p.time.slice(0,5)}
     receipt=p.eventId?{...(await updateCalendarEvent(config,p.eventId,details)),eventId:p.eventId}:await createCalendarEvent(config,{...details,requestId:`${work.tour_id}-v${work.schedule_version}`})
    }
   } else {
    const subject=p.action==='cancel'?`Tour cancelled at ${p.propertyName}`:`Your updated tour at ${p.propertyName}`
    const body=p.action==='cancel'?`Hi ${p.name || 'there'}, your tour at ${p.propertyName} on ${p.date} at ${p.time.slice(0,5)} has been cancelled.`:`Hi ${p.name || 'there'}, your tour at ${p.propertyName} is now scheduled for ${p.date} at ${p.time.slice(0,5)}${p.timezone?` (${p.timezone})`:''}. Please use this updated time.`
    if(!(work.kind==='notice_email'?p.email:p.phone))throw new Error('Recipient is missing')
    const dispatch=work.dispatch || {to:(work.kind==='notice_email'?p.email:p.phone)!,from:work.kind==='notice_email'?process.env.RESEND_FROM_EMAIL:process.env.TELNYX_PHONE_NUMBER,subject,body:work.kind==='notice_sms'?`${body} Reply STOP to opt out.`:body}
    if(!dispatch.from)throw new Error('Sender is not configured')
    const started=await start(dispatch as Json),pinned=started.dispatch
    if(!pinned?.to||!pinned.from||!pinned.body)throw new Error('Saved delivery content is unavailable')
    const sent=work.kind==='notice_email'?await sendEmail(pinned.to,pinned.subject,pinned.body,pinned.from,undefined,undefined,`tour-change/${work.id}`):await sendMessage({channel:'sms',to:pinned.to,body:pinned.body,from:pinned.from,propertyName:p.propertyName})
    if(!sent.success || !sent.messageId)throw new Error('Provider acceptance is unconfirmed')
    receipt={messageId:sent.messageId}
   }
   await finish(true,receipt);result.succeeded++
  } catch {
   // A known acceptance is never overwritten by a generic failure. If its checkpoint
   // is unavailable, the durable lease expires into review; no provider retry occurs.
   if(receipt===null)await finish(false,{error:'provider_or_receipt_unconfirmed'})
   result.review++
  }
 }
 return result
}
