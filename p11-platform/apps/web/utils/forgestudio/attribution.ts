import {createHash,createHmac} from 'node:crypto'
import {measurementRpc} from './engagement-sync'
export type AttributionEventType='landing_view'|'lead'|'tour_booked'|'tour_completed'|'lease'
function secret(){const value=process.env.ATTRIBUTION_HASH_SECRET||process.env.CRON_SECRET;if(!value)throw new Error('Attribution observation signing is not configured');return value}
function anonymousHash(value:string){return createHmac('sha256',secret()).update(value).digest('hex')}
export async function recordAttributionEvent(input:{trackingToken:string;eventType:AttributionEventType;anonymousSubject:string;occurredAt?:string;attributionWindowDays?:number;metadata?:Record<string,unknown>}):Promise<{recorded:boolean;publicationId:string;eventId:string;evidenceKind:string;eventState:string}>{
 const occurredAt=input.occurredAt??new Date().toISOString(),redirect=input.eventType==='landing_view'
 if(!Number.isFinite(Date.parse(occurredAt)))throw new Error('A valid source event time is required')
 if(input.attributionWindowDays!==undefined&&input.attributionWindowDays!==30)throw new Error('Attributed observations use the saved 30-day measurement window')
 const sourceSystem=redirect?'tracked_redirect':String(input.metadata?.sourceSystem??'').trim().toLowerCase(),sourceEventId=String(input.metadata?.sourceEventId??'').trim()
 if(!redirect&&(!input.occurredAt||sourceSystem.length<1||sourceSystem.length>100||sourceEventId.length<1||sourceEventId.length>200))throw new Error('Business outcome reports require an exact source event identity and time')
 const subjectHash=anonymousHash(input.anonymousSubject)
 // Redirect observations retain the old hourly privacy bucket. Business events
 // use their source identity regardless of retry time or attributed publication.
 const sourceHash=redirect?createHash('sha256').update(`${input.trackingToken}:${subjectHash}:${occurredAt.slice(0,13)}`).digest('hex'):anonymousHash(`${sourceSystem}:${sourceEventId}`)
 const result=await measurementRpc('record_forgestudio_attribution',{p_token:input.trackingToken,p_event_type:input.eventType,p_subject_hash:subjectHash,p_occurred_at:occurredAt,p_source_system:sourceSystem,p_source_event_hash:sourceHash})
 if(!['saved','replayed'].includes(String(result.state)))throw new Error(result.state==='outside_measurement_window'?'The event is outside the published post’s 30-day measurement window.':result.state==='source_event_conflict'?'This source event already has different saved attribution evidence.':'A confirmed published post is required for attributed observations.')
 return {recorded:result.state==='saved',publicationId:String(result.publicationId),eventId:String(result.eventId),evidenceKind:String(result.evidenceKind),eventState:String(result.eventState)}
}
