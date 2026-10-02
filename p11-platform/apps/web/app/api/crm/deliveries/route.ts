import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {crmRpc} from '@/utils/crm/workspace'
import {isDeliveryPaused,DELIVERY_PAUSED_MESSAGE} from '@/utils/services/delivery-guard'
import {getDataEngineUrl} from '@/utils/services/runtime-config'
const guid=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const common={propertyId:guid,requestId:z.string().uuid()}
const schema=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('prepare'),leadId:guid,note:z.string().trim().min(1).max(16000).optional()}).strict(),
 z.object({...common,action:z.literal('run'),handoffId:guid,payloadHash:z.string().regex(/^[0-9a-f]{64}$/)}).strict(),
 z.object({...common,action:z.literal('check_destination'),handoffId:guid}).strict(),
 z.object({...common,action:z.literal('accept_destination'),handoffId:guid,checkId:guid,evidenceHash:z.string().regex(/^[0-9a-f]{64}$/)}).strict(),
 z.object({...common,action:z.literal('stop'),handoffId:guid}).strict()
])
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}})
const messages:Record<string,string>={contact_mapping_required:'Map a contact value to the provider’s standard Email or Phone field before preparing this transfer.',note_capability_required:'This connection has not qualified note delivery.',worker_pending:'The original worker is still within its confirmation window. Reload the saved result shortly.',destination_unconfirmed:'The check did not confirm a destination. The transfer remains on hold.',evidence_expired:'Run a fresh destination check before accepting this record.',destination_conflict:'The returned destination conflicts with the recorded link. The transfer remains on hold.',note_evidence_required:'A lead lookup cannot confirm note delivery. A provider note receipt is required.',qualification_required:'This connection still needs verified provider capabilities before a transfer can be prepared.',configuration_required:'Select and qualify one CRM connection for this property first.',handoff_in_progress:'This lead already has an unfinished transfer. Review its saved state.',legacy_link_review_required:'This lead has an older CRM link whose destination needs review.',confirmed_link_required:'Confirm the lead transfer before sending a note.',contact_required:'Add an email address or phone number before preparing a transfer.',reconciliation_required:'This attempt may have reached the CRM. Reconcile it before making another attempt.',stale_source:'The lead changed after this transfer was prepared. Stop it and prepare a fresh review.',stale_configuration:'The connection changed after this transfer was prepared.',preview_conflict:'The approval must match the saved transfer values.',owner_required:'The operator who prepared this transfer must approve it.'}
function respond(data:Record<string,unknown>){const ok=['saved','queued','applied','replayed','already_approved','already_linked','cancelled','confirmed','searching','sending','needs_reconciliation','failed'].includes(String(data.state));return json(ok?data:{...data,error:messages[String(data.state)]||'This transfer is unavailable for the current access or saved version.'},ok?200:data.state==='forbidden'?403:409)}
export async function GET(req:NextRequest){try{
 const client=await createClient();const {data:{user},error}=await client.auth.getUser();if(error||!user)return json({error:'Unauthorized'},401)
 const property=guid.safeParse(req.nextUrl.searchParams.get('propertyId')),handoff=req.nextUrl.searchParams.get('handoffId'),page=Number(req.nextUrl.searchParams.get('page')||1)
 if(!property.success||handoff&&!guid.safeParse(handoff).success||!Number.isInteger(page)||page<1||page>100000)return json({error:'A property and valid saved transfer or page are required.'},400)
 const data=await crmRpc(handoff?'preview_crm_handoff':'read_crm_handoffs',{p_property_id:property.data,p_actor_id:user.id,...(handoff?{p_handoff_id:handoff}:{p_page:page})})
 return respond({...data,deliveryPaused:isDeliveryPaused()})
}catch{return json({error:'Saved CRM transfers could not be loaded.'},503)}}
export async function POST(req:NextRequest){try{
 const client=await createClient();const {data:{user},error}=await client.auth.getUser();if(error||!user)return json({error:'Unauthorized'},401)
 const parsed=schema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return json({error:'A property, saved request identity and valid transfer details are required.'},400)
 const body=parsed.data,scope={p_property_id:body.propertyId,p_actor_id:user.id}
 if(body.action==='prepare')return respond(await crmRpc('request_crm_handoff',{...scope,p_lead_id:body.leadId,p_request_key:'operator/'+body.requestId,p_origin:'operator',p_note:body.note||null}))
 if(body.action==='stop')return respond(await crmRpc('stop_crm_handoff',{...scope,p_handoff_id:body.handoffId,p_request_id:body.requestId}))
 if(body.action==='accept_destination')return respond(await crmRpc('accept_crm_reconciliation',{...scope,p_handoff_id:body.handoffId,p_check_id:body.checkId,p_evidence_hash:body.evidenceHash,p_request_id:body.requestId}))
 if(body.action==='check_destination'){
  const check=await crmRpc('request_crm_reconciliation',{...scope,p_handoff_id:body.handoffId,p_request_id:body.requestId})
  if(!['queued','replayed'].includes(String(check.state)))return respond(check)
  try{await fetch(`${getDataEngineUrl()}/crm/reconciliation-operation`,{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':process.env.DATA_ENGINE_API_KEY||''},body:JSON.stringify({check_id:check.checkId}),signal:AbortSignal.timeout(45000),cache:'no-store'})}catch{/* Reopen saved read evidence; never resend the transfer. */}
  return respond(await crmRpc('preview_crm_handoff',{...scope,p_handoff_id:body.handoffId}))
 }
 if(isDeliveryPaused())return json({state:'delivery_paused',error:DELIVERY_PAUSED_MESSAGE},423)
 const approved=await crmRpc('approve_crm_handoff',{...scope,p_handoff_id:body.handoffId,p_request_id:body.requestId,p_payload_hash:body.payloadHash})
 if(!['applied','replayed','already_approved'].includes(String(approved.state)))return respond(approved)
 // The private worker claim and write intent prevent a second provider call after a lost reply.
 try{await fetch(`${getDataEngineUrl()}/crm/delivery-operation`,{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':process.env.DATA_ENGINE_API_KEY||''},body:JSON.stringify({handoff_id:body.handoffId}),signal:AbortSignal.timeout(45000),cache:'no-store'})}catch{/* Recover only from saved state below. */}
 return respond(await crmRpc('preview_crm_handoff',{...scope,p_handoff_id:body.handoffId}))
}catch{return json({error:'The transfer result could not be confirmed. Reload its saved state before retrying.'},503)}}
