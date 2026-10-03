import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {crmRpc} from '@/utils/crm/workspace'
import {getDataEngineUrl} from '@/utils/services/runtime-config'
const guid=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('start'),propertyId:guid,requestId:z.string().uuid(),integrationId:guid,revision:z.number().int().positive(),kind:z.enum(['connection','schema'])}).strict(),
 z.object({action:z.literal('stop'),propertyId:guid,requestId:z.string().uuid(),operationId:guid}).strict()
])
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}})
function respond(result:Record<string,unknown>){if(['saved','applied','replayed'].includes(String(result.state)))return json(result);return json({...result,error:result.state==='operation_in_progress'?'A saved check is still open. Review or stop it before starting another.':result.state==='stale'?'The configuration changed. Reload saved setup.':'This request is unavailable for your current access or saved version.'},result.state==='forbidden'?403:409)}
export async function GET(req:NextRequest){try{
 const client=await createClient();const {data:{user},error}=await client.auth.getUser();if(error||!user)return json({error:'Unauthorized'},401)
 const property=guid.safeParse(req.nextUrl.searchParams.get('propertyId'));if(!property.success)return json({error:'A valid property is required.'},400)
 return respond(await crmRpc('read_crm_setup_operations',{p_property_id:property.data,p_actor_id:user.id}))
}catch{return json({error:'Saved CRM checks could not be loaded.'},503)}}
export async function POST(req:NextRequest){try{
 const client=await createClient();const {data:{user},error}=await client.auth.getUser();if(error||!user)return json({error:'Unauthorized'},401)
 const parsed=schema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return json({error:'A saved connection and request identity are required.'},400)
 const body=parsed.data,common={p_property_id:body.propertyId,p_actor_id:user.id,p_request_id:body.requestId}
 if(body.action==='stop')return respond(await crmRpc('stop_crm_setup_operation',{...common,p_operation_id:body.operationId}))
 const requested=await crmRpc('request_crm_setup_operation',{...common,p_integration_id:body.integrationId,p_revision:body.revision,p_kind:body.kind})
 if(!['applied','replayed'].includes(String(requested.state)))return respond(requested)
 const operation=requested.operation as {id:string;state:string}
 if(operation.state==='queued'){
  try{await fetch(`${getDataEngineUrl()}/crm/setup-operation`,{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':process.env.DATA_ENGINE_API_KEY||''},body:JSON.stringify({operation_id:operation.id}),signal:AbortSignal.timeout(45000),cache:'no-store'})}catch{/* The saved queue/claim is authoritative; never resubmit a provider call here. */}
 }
 return respond(await crmRpc('read_crm_setup_operations',{p_property_id:body.propertyId,p_actor_id:user.id}))
}catch{return json({error:'The check result could not be confirmed. Reload saved checks before retrying.'},503)}}
