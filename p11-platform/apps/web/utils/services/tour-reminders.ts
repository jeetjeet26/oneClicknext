import type {Database,Json} from '@/types/supabase'
import type {SupabaseClient} from '@supabase/supabase-js'
import {createServiceClient} from '@/utils/supabase/admin'
import {isDeliveryPaused,DELIVERY_PAUSED_MESSAGE} from './delivery-guard'
import {generateICSContent,getICSAttachment} from './calendar-invite'
import {sendEmail,sendMessage,isMessagingConfigured} from './messaging'
import {processTourScheduleWork} from './tour-schedule-delivery'
import type {TourSource} from './tour-outcomes'

export type ReminderChannel = {
 id:string;work_id:string;channel:'email'|'sms';recipient:string;state:'queued'|'running'|'accepted'|'review'|'skipped';
 attempts:number;body:string|null;subject:string|null;sender:string|null;provider_id:string|null;error_code:string|null;started_at:string|null
}
export type ReminderWork = {
 id:string;property_id:string;lead_id:string;tour_source:TourSource;tour_id:string;schedule_version:number;kind:'confirmation'|'reminder_24h'|'reminder_1h';
 state:string;lease_token:string;lease_until:string|null;created_at:string;error_code:string|null;
 payload:{firstName:string;propertyName:string;date:string;time:string;timezone:string;startsAt:string;durationMinutes?:number;reminderVersion?:number;address?:{street?:string;city?:string}};
 channels:ReminderChannel[]
}
type Candidate={propertyId:string;source:TourSource;tourId:string;version:number;kind:ReminderWork['kind']}
type Pending={candidates:Candidate[];reminders24h:number;reminders1h:number;confirmations:number;needsReview:number;held:number}
type ReminderDatabase=Omit<Database,'public'> & {public:Omit<Database['public'],'Functions'|'Tables'> & {
 Functions:Database['public']['Functions'] & {
  recover_tour_reminders:{Args:{p_limit?:number};Returns:number}
  pending_tour_reminders:{Args:{p_property_id?:string;p_limit?:number};Returns:Json}
  prepare_tour_reminder:{Args:{p_property_id:string;p_source:TourSource;p_tour_id:string;p_version:number;p_kind:string};Returns:Json}
  start_tour_reminder_channel:{Args:{p_id:string;p_token:string;p_body:string;p_subject:string|null;p_sender:string};Returns:Json}
  finish_tour_reminder_channel:{Args:{p_id:string;p_token:string;p_provider_id:string|null};Returns:boolean}
  settle_tour_reminder:{Args:{p_id:string;p_token:string};Returns:string}
  review_tour_reminder:{Args:{p_property_id:string;p_lead_id:string;p_channel_id:string;p_actor_id:string;p_request_id:string;p_input:Json};Returns:Json}
 },Tables:Database['public']['Tables'] & {
  tour_schedule_work:{Row:ReminderWork;Insert:never;Update:never;Relationships:[]}
  tour_reminder_channels:{Row:ReminderChannel;Insert:never;Update:never;Relationships:[]}
  tour_reminder_reviews:{Row:{channel_id:string;property_id:string;lead_id:string;input:{reason:string};created_at:string};Insert:never;Update:never;Relationships:[]}
 }
}}
export const reminderDb=(db:SupabaseClient<Database>)=>db as unknown as SupabaseClient<ReminderDatabase>
export interface ReminderResult {processed:number;confirmations:number;reminders24h:number;reminders1h:number;failed:number;errors:string[];acceptedChannels:number;review:number}

export function reminderContent(work:ReminderWork,channel:ReminderChannel['channel']) {
 const p=work.payload
 const at=new Date(p.startsAt)
 const date=new Intl.DateTimeFormat('en-US',{timeZone:p.timezone,weekday:'long',month:'long',day:'numeric'}).format(at)
 const time=new Intl.DateTimeFormat('en-US',{timeZone:p.timezone,hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(at)
 const when=work.kind==='confirmation'?'Tour confirmation':work.kind==='reminder_24h'?'Upcoming tour':'Tour reminder'
 const body=`Hi ${p.firstName || 'there'}, your tour at ${p.propertyName} is scheduled for ${date} at ${time}.${p.address?.street?` Address: ${p.address.street}${p.address.city?`, ${p.address.city}`:''}.`:''} Please contact the leasing team if you need to change your plans.${channel==='sms'?' Reply STOP to opt out.':''}`
 return {body,subject:channel==='email'?`${when} at ${p.propertyName}`:null}
}
export function confirmationAttachment(work:ReminderWork) {
 if(work.kind!=='confirmation')return undefined
 const p=work.payload
 return [getICSAttachment(generateICSContent({title:`Tour: ${p.propertyName}`,startDate:p.date,startTime:p.time,startsAt:p.startsAt,
  durationMinutes:p.durationMinutes||30,uid:`tour-${work.tour_id}-v${work.schedule_version}@p11`,timestamp:work.created_at,location:p.address?.street,
  description:'Your scheduled property tour. Contact the leasing team to change your plans.'}))]
}
async function readPending(db:ReturnType<typeof reminderDb>,propertyId?:string):Promise<Pending> {
 const r=await db.rpc('pending_tour_reminders',{...(propertyId?{p_property_id:propertyId}:{}),p_limit:100})
 if(r.error || !r.data)throw new Error('Reminder eligibility could not be loaded')
 const pending=r.data as unknown as Pending
 if(!Array.isArray(pending.candidates))throw new Error('Reminder eligibility response is invalid')
 return pending
}
export async function getPendingRemindersCount(propertyId?:string) {
 const {reminders24h,reminders1h,confirmations,needsReview,held}=await readPending(reminderDb(createServiceClient()),propertyId)
 return {reminders24h,reminders1h,confirmations:confirmations??0,needsReview,held}
}

/** No provider call is retried after an ambiguous response. Operator review is required. */
export async function processTourReminders():Promise<ReminderResult> {
 const result:ReminderResult={processed:0,confirmations:0,reminders24h:0,reminders1h:0,failed:0,errors:[],acceptedChannels:0,review:0}
 if(isDeliveryPaused()){result.errors.push(DELIVERY_PAUSED_MESSAGE);return result}
 const db=reminderDb(createServiceClient())
 const updates=await processTourScheduleWork()
 if(updates.review)result.errors.push(`${updates.review} tour updates need delivery review`)
 const recovered=await db.rpc('recover_tour_reminders',{p_limit:100})
 if(recovered.error)throw new Error('Interrupted reminder recovery could not be confirmed')
 const pending=await readPending(db)
 result.review=pending.needsReview+pending.held
 if(result.review)result.errors.push(`${result.review} reminder schedules or deliveries need review`)
 for(const candidate of pending.candidates) {
  if(isDeliveryPaused()){result.errors.push(DELIVERY_PAUSED_MESSAGE);break}
  try {
   const claimed=await db.rpc('prepare_tour_reminder',{p_property_id:candidate.propertyId,p_source:candidate.source,p_tour_id:candidate.tourId,p_version:candidate.version,p_kind:candidate.kind})
   if(claimed.error)throw new Error('Reminder claim could not be saved')
   if(!claimed.data)continue
   const work=claimed.data as unknown as ReminderWork
   if(!Array.isArray(work.channels))throw new Error('Reminder channel snapshot is missing')
   result.processed++
   for(const channel of work.channels) {
    if(channel.state!=='queued')continue
    if(isDeliveryPaused()){result.errors.push(DELIVERY_PAUSED_MESSAGE);break}
    const content=channel.body?{body:channel.body,subject:channel.subject}:reminderContent(work,channel.channel)
    const configured=isMessagingConfigured()[channel.channel]
    const sender=channel.sender || (channel.channel==='email'?process.env.RESEND_FROM_EMAIL:process.env.TELNYX_PHONE_NUMBER) || ''
    const started=await db.rpc('start_tour_reminder_channel',{p_id:channel.id,p_token:work.lease_token,p_body:content.body,p_subject:content.subject,p_sender:configured?sender:''})
    // A lost start acknowledgement could already have persisted an attempt. Never send without it.
    if(started.error)throw new Error('Reminder attempt could not be confirmed; review before retrying')
    if(!started.data)continue
    let providerId:string|null=null
    try {
     const sent=channel.channel==='email'
      ?await sendEmail(channel.recipient,content.subject!,content.body,sender,undefined,confirmationAttachment(work),`tour-reminder/${channel.id}`)
      :await sendMessage({channel:'sms',to:channel.recipient,body:content.body,from:sender,propertyName:work.payload.propertyName})
     if(sent.success && sent.messageId)providerId=sent.messageId
    } catch { /* The attempt is already durable; ambiguous transport failures go to review. */ }
    const saved=await db.rpc('finish_tour_reminder_channel',{p_id:channel.id,p_token:work.lease_token,p_provider_id:providerId})
    // Do not overwrite a possibly saved receipt with failure after a lost acknowledgement.
    if(saved.error || !saved.data)throw new Error('Provider receipt could not be confirmed; review before retrying')
    if(providerId)result.acceptedChannels++
   }
   const settled=await db.rpc('settle_tour_reminder',{p_id:work.id,p_token:work.lease_token})
   if(settled.error || !settled.data)throw new Error('Reminder completion could not be confirmed')
   if(settled.data==='completed') {
    if(work.kind==='confirmation')result.confirmations++;else if(work.kind==='reminder_24h')result.reminders24h++;else result.reminders1h++
   } else if(['review','running','stale'].includes(settled.data)) {
    result.review++;result.errors.push(`Tour ${candidate.tourId}: reminder delivery needs review`)
   }
  } catch(error) {
   result.failed++;result.errors.push(`Tour ${candidate.tourId}: ${error instanceof Error?error.message:'Reminder failed'}`)
  }
 }
 const remaining=await readPending(db)
 result.review=Math.max(result.review,remaining.needsReview+remaining.held)
 if(result.review && !result.errors.length)result.errors.push(`${result.review} reminder schedules or deliveries need review`)
 return result
}

