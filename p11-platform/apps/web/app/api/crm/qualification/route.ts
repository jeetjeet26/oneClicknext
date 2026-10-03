import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {crmRpc} from '@/utils/crm/workspace'
import {isDeliveryPaused,DELIVERY_PAUSED_MESSAGE} from '@/utils/services/delivery-guard'
import {getDataEngineUrl} from '@/utils/services/runtime-config'
const guid=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const common={propertyId:guid,requestId:z.string().uuid()}
const schema=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('prepare'),integrationId:guid,revision:z.number().int().positive()}).strict(),
 z.object({...common,action:z.enum(['run','recover','activate','stop']),operationId:guid,payloadHash:z.string().regex(/^[0-9a-f]{64}$/)}).strict()
])
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}})
const messages:Record<string,string>={provider_contract_required:'This provider needs its tenant-specific delivery contract qualified before activation. Saved connection and schema reads remain available.',mapping_approval_required:'Approve the saved field mapping first.',email_mapping_required:'Map Email to the provider’s standard email field before preparing the test.',phone_mapping_required:'Map Phone to the provider’s standard phone field, or omit it.',operation_in_progress:'Finish or recover the existing test before preparing another.',stale_configuration:'The connection or approved mapping changed. Review the saved setup.',worker_pending:'The worker is still within its confirmation window. Reload its saved result shortly.',cleanup_required:'The test record may still exist in the CRM. Recover its saved result before changing the connection.',verification_required:'A complete, recent test receipt and confirmed cleanup are required before activation.',owner_required:'The operator who prepared this test must approve it.',preview_conflict:'Reload and review the exact saved test values.',already_started:'This test already started. Recover its saved result.',not_recoverable:'This test has finished. Reload its saved result.'}
function respond(data:Record<string,unknown>){const ok=['saved','applied','replayed','already_finished'].includes(String(data.state));return json(ok?data:{...data,error:messages[String(data.state)]||'This test is unavailable for the current access or saved version.'},ok?200:data.state==='forbidden'?403:409)}
export async function GET(req:NextRequest){try{
 const client=await createClient();const {data:{user},error}=await client.auth.getUser();if(error||!user)return json({error:'Unauthorized'},401)
 const property=guid.safeParse(req.nextUrl.searchParams.get('propertyId'));if(!property.success)return json({error:'A valid property is required.'},400)
 return respond({...await crmRpc('read_crm_qualifications',{p_property_id:property.data,p_actor_id:user.id}),deliveryPaused:isDeliveryPaused()})
}catch{return json({error:'Saved provider tests could not be loaded.'},503)}}
export async function POST(req:NextRequest){try{
 const client=await createClient();const {data:{user},error}=await client.auth.getUser();if(error||!user)return json({error:'Unauthorized'},401)
 const parsed=schema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return json({error:'A saved test identity and exact review are required.'},400)
 const body=parsed.data,scope={p_property_id:body.propertyId,p_actor_id:user.id,p_request_id:body.requestId}
 if(body.action==='prepare')return respond(await crmRpc('prepare_crm_qualification',{...scope,p_integration_id:body.integrationId,p_revision:body.revision}))
 if(['run','activate'].includes(body.action)&&isDeliveryPaused())return json({state:'delivery_paused',error:DELIVERY_PAUSED_MESSAGE},423)
 const result=await crmRpc('command_crm_qualification',{...scope,p_operation_id:body.operationId,p_kind:body.action,p_payload_hash:body.payloadHash})
 if(!['applied','replayed'].includes(String(result.state))||!['run','recover'].includes(body.action))return respond(result)
 try{await fetch(`${getDataEngineUrl()}/crm/qualification-operation`,{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':process.env.DATA_ENGINE_API_KEY||''},body:JSON.stringify({operation_id:body.operationId}),signal:AbortSignal.timeout(45000),cache:'no-store'})}catch{/* Saved receipts determine the outcome, including an uncertain write. */}
 return respond(await crmRpc('read_crm_qualifications',{p_property_id:body.propertyId,p_actor_id:user.id}))
}catch{return json({error:'The provider test result could not be confirmed. Reload saved tests before trying again.'},503)}}
