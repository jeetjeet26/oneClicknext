import {z} from 'zod'
import {createServiceClient} from '@/utils/supabase/admin'
import {getDataEngineUrl} from '@/utils/services/runtime-config'
import {isDeliveryPaused,DELIVERY_PAUSED_MESSAGE} from './delivery-guard'

export interface LeadData {first_name?:string;last_name?:string;email?:string;phone?:string;source?:string;status?:string;move_in_date?:string;bedrooms?:string|number;notes?:string;metadata?:Record<string,unknown>}
export interface CRMSyncResult {success:boolean;action:'created'|'linked'|'skipped'|'failed'|'retry_scheduled'|'dead_lettered';externalId?:string;error?:string;retryAt?:string;handoffId?:string}
export interface CRMNoteResult {success:boolean;action:'note_added'|'skipped'|'unsupported'|'failed';error?:string;handoffId?:string}
export interface SyncLeadToCRMOptions {requestKey?:string;origin?:'operator'|'lumaleasing'|'siteforge'|'tourspark'|'workflow';actorId?:string;attempt?:number;preserveClaimLease?:boolean}
export interface ProcessPendingCRMSyncsResult {processed:number;succeeded:number;scheduledRetries:number;deadLettered:number;skipped:number;failed:number;errors:string[]}
type SavedHandoff={id:string;property_id:string;state:string;kind:'lead'|'note';external_id:string|null;origin:string;execution_approved_at:string|null}
const held=(error:string,handoffId?:string):CRMSyncResult=>({success:false,action:'skipped',error,...(handoffId?{handoffId}:{})})
async function savedResult(propertyId:string,handoffId:string):Promise<CRMSyncResult>{
 const db=createServiceClient();const read=await db.from('crm_handoffs').select('id,state,kind,external_id').eq('id',handoffId).eq('property_id',propertyId).single()
 if(read.error||!read.data)throw new Error('Saved CRM transfer state could not be confirmed')
 const h=read.data
 if(h.state==='confirmed'){
  const receipt=await db.from('crm_handoff_receipts').select('stage,result').eq('handoff_id',h.id).in('stage',['result','reconciliation']).order('created_at',{ascending:false}).limit(1).maybeSingle()
  if(receipt.error||!receipt.data)throw new Error('CRM confirmation receipt could not be loaded')
  const proof=z.object({outcome:z.enum(['created','linked','note_added','destination_confirmed'])}).parse(receipt.data.result)
  if(h.kind==='note'&&proof.outcome!=='note_added'||h.kind==='lead'&&proof.outcome==='note_added')throw new Error('CRM confirmation does not match the saved transfer')
  return {success:true,action:proof.outcome==='created'?'created':'linked',externalId:h.external_id||undefined,handoffId:h.id}
 }
 if(h.state==='needs_reconciliation'||h.state==='sending')return {success:false,action:'dead_lettered',handoffId:h.id,error:'CRM outcome needs destination recovery. This transfer will not be resent.'}
 return held(h.state==='queued'?'CRM transfer saved; approval or worker execution is still pending.':h.state==='searching'?'CRM transfer is checking the destination.':'CRM transfer did not confirm delivery. Review its saved result.',h.id)
}
async function dispatch(propertyId:string,handoffId:string):Promise<CRMSyncResult>{
 if(isDeliveryPaused())return held(DELIVERY_PAUSED_MESSAGE,handoffId)
 try{await fetch(`${getDataEngineUrl()}/crm/delivery-operation`,{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':process.env.DATA_ENGINE_API_KEY||''},body:JSON.stringify({handoff_id:handoffId}),signal:AbortSignal.timeout(45000),cache:'no-store'})}catch{/* Saved state, never a transport reply, determines the outcome. */}
 return savedResult(propertyId,handoffId)
}
async function requestHandoff(propertyId:string,leadId:string,options?:SyncLeadToCRMOptions,note?:string):Promise<CRMSyncResult>{
 if(isDeliveryPaused())return held(DELIVERY_PAUSED_MESSAGE)
 if(!options?.requestKey||!options.origin||options.origin==='operator'&&!options.actorId||options.origin!=='operator'&&options.actorId)return held('A saved source-event identity and origin are required for CRM delivery.')
 try{
  const db=createServiceClient();const response=await db.rpc('request_crm_handoff',{p_property_id:propertyId,p_lead_id:leadId,p_request_key:options.requestKey,p_origin:options.origin,p_actor_id:options.actorId||null,p_note:note||null})
  if(response.error||!response.data)throw new Error('CRM request receipt could not be confirmed')
  const data=z.object({state:z.string(),handoffId:z.string().optional(),externalId:z.string().optional()}).parse(response.data)
  if(data.state==='already_linked')return {success:true,action:'linked',externalId:data.externalId,handoffId:data.handoffId}
  if(!['queued','replayed'].includes(data.state))return held(({legacy_delivery_review_required:'This older lead needs review in Lasso before resending.',existing_contact_review_required:'A matching contact already has delivery history. Review it before creating another record.',qualification_required:'CRM provider qualification is required. No record was sent.',legacy_link_review_required:'The older CRM link needs destination review.',handoff_in_progress:'This lead has an unfinished saved transfer. Review it before another attempt.',contact_required:'An email address or phone number is required.',forbidden:'Current access does not permit this CRM request.'} as Record<string,string>)[data.state]||'CRM setup or saved request requires review. No record was sent.')
  if(!data.handoffId)throw new Error('Saved CRM transfer identity is missing')
  // Manual source actions prepare a review; approval is a separate recorded command.
  if(options.origin==='operator')return held('CRM transfer prepared for exact-value review and approval.',data.handoffId)
  return await dispatch(propertyId,data.handoffId)
 }catch{return {success:false,action:'failed',error:'CRM result could not be confirmed. Recover the saved transfer before retrying.'}}
}
export async function pushLeadToCRM(propertyId:string,leadId:string,_leadData:LeadData,options?:SyncLeadToCRMOptions):Promise<CRMSyncResult>{return requestHandoff(propertyId,leadId,options)}
export const syncLeadToCRM=pushLeadToCRM
export async function pushLeadNoteToCRM(propertyId:string,leadId:string,note:string,options?:SyncLeadToCRMOptions):Promise<CRMNoteResult>{
 if(!note.trim())return {success:false,action:'skipped',error:'A saved note is required.'}
 const result=await requestHandoff(propertyId,leadId,options,note.trim())
 return {success:result.success,action:result.success?'note_added':result.action==='failed'?'failed':'skipped',error:result.error,handoffId:result.handoffId}
}
export async function recordLeadNoteAndSyncToCRM(propertyId:string,leadId:string,note:string|null,options?:SyncLeadToCRMOptions&{persistNote?:boolean}):Promise<CRMNoteResult|CRMSyncResult>{
 // Source products own their recorded note mutations. Appending here would duplicate them on retry.
 if(options?.persistNote!==false)return held('Save the source note once with its source-event identity before CRM handoff.')
 return note?.trim()?pushLeadNoteToCRM(propertyId,leadId,note,options):held('No CRM note was requested.')
}
export async function processPendingCRMSyncs(limit=50):Promise<ProcessPendingCRMSyncsResult>{
 const result:ProcessPendingCRMSyncsResult={processed:0,succeeded:0,scheduledRetries:0,deadLettered:0,skipped:0,failed:0,errors:[]}
 if(isDeliveryPaused())return result
 const db=createServiceClient();const batchSize=Math.max(1,Math.min(100,Math.trunc(limit)||50))
 const prepared=await db.rpc('prepare_pending_crm_handoffs',{p_limit:batchSize})
 if(prepared.error||!prepared.data||typeof prepared.data!=='object'||Array.isArray(prepared.data)||prepared.data.state!=='prepared'){
  result.errors.push('Pending CRM leads could not be prepared safely');return result
 }
 const queued=await db.from('crm_handoffs').select('id,property_id,state,kind,external_id,origin,execution_approved_at').eq('state','queued').or('origin.neq.operator,execution_approved_at.not.is.null').order('requested_at',{ascending:true}).limit(Math.max(1,Math.min(100,Math.trunc(limit)||50)))
 if(queued.error){result.errors.push('Saved CRM queue could not be loaded');return result}
 for(const h of (queued.data||[]) as SavedHandoff[]){
  result.processed++
  try{const sent=await dispatch(h.property_id,h.id);if(sent.success)result.succeeded++;else if(sent.action==='dead_lettered')result.deadLettered++;else result.skipped++}
  catch{result.failed++;result.errors.push('A saved CRM result could not be confirmed')}
 }
 return result
}
