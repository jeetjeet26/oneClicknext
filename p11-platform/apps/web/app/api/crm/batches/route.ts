import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {crmRpc} from '@/utils/crm/workspace'
import {isDeliveryPaused,DELIVERY_PAUSED_MESSAGE} from '@/utils/services/delivery-guard'
const guid=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const common={propertyId:guid,requestId:z.string().uuid()}
const schema=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('prepare'),leadIds:z.array(guid).min(1).max(100).refine(ids=>new Set(ids.map(id=>id.toLowerCase())).size===ids.length)}).strict(),
 z.object({...common,action:z.literal('approve'),batchId:guid,manifestHash:z.string().regex(/^[0-9a-f]{64}$/)}).strict(),
 z.object({...common,action:z.literal('stop'),batchId:guid,manifestHash:z.string().regex(/^[0-9a-f]{64}$/)}).strict()
])
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}})
const messages:Record<string,string>={selection_changed:'One or more selected leads are no longer available in this property. Refresh the selection.',request_conflict:'This saved request belongs to a different selection or action.',preview_conflict:'Reload and review the exact saved batch before approving.',owner_required:'The operator who prepared this batch must approve it.',stale_source:'A selected lead changed after review. Stop the remaining transfers and prepare a fresh batch.',stale_configuration:'The CRM connection changed. Stop the remaining transfers and prepare a fresh batch after setup review.',batch_changed:'A transfer changed after preparation. Review its saved result and prepare a fresh selection if needed.',stopped:'This batch was stopped. Its saved selection cannot be approved again.',nothing_to_approve:'This batch has no prepared transfers to approve.'}
function respond(data:Record<string,unknown>){const ok=['saved','applied','replayed','already_recorded'].includes(String(data.state));return json(ok?data:{...data,error:messages[String(data.state)]||'This saved batch is unavailable for the current access.'},ok?200:data.state==='forbidden'?403:409)}
export async function GET(req:NextRequest){try{
 const client=await createClient();const {data:{user},error}=await client.auth.getUser();if(error||!user)return json({error:'Unauthorized'},401)
 const params=req.nextUrl.searchParams,property=guid.safeParse(params.get('propertyId')),batch=params.get('batchId'),page=Number(params.get('page')||1),view=params.get('view')||'batches',search=params.get('search')||''
 if(!property.success||batch&&!guid.safeParse(batch).success||!Number.isInteger(page)||page<1||page>100000||search.length>200||!['batches','leads'].includes(view)||view==='leads'&&batch)return json({error:'A property and valid batch or search page are required.'},400)
 const scope={p_property_id:property.data,p_actor_id:user.id}
 const data=await crmRpc(view==='leads'?'search_crm_bulk_leads':'read_crm_bulk',{...scope,...(view==='leads'?{p_search:search,p_page:page}:{...(batch?{p_batch_id:batch}:{}),p_page:page})})
 return respond({...data,deliveryPaused:isDeliveryPaused(),canApproveOwnBatch:data.actorId===user.id})
}catch{return json({error:'Saved CRM batches could not be loaded.'},503)}}
export async function POST(req:NextRequest){try{
 const client=await createClient();const {data:{user},error}=await client.auth.getUser();if(error||!user)return json({error:'Unauthorized'},401)
 const parsed=schema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return json({error:'Select up to 100 distinct leads, or provide an exact saved batch review.'},400)
 const body=parsed.data,scope={p_property_id:body.propertyId,p_actor_id:user.id,p_request_id:body.requestId}
 if(body.action==='prepare')return respond(await crmRpc('prepare_crm_bulk',{...scope,p_lead_ids:body.leadIds}))
 // Approval releases exact child requests to the existing durable queue. This route never sends a provider request.
 if(body.action==='approve'&&isDeliveryPaused())return json({state:'delivery_paused',error:DELIVERY_PAUSED_MESSAGE},423)
 return respond(await crmRpc('command_crm_bulk',{...scope,p_batch_id:body.batchId,p_kind:body.action,p_manifest_hash:body.manifestHash}))
}catch{return json({error:'The batch result could not be confirmed. Reload saved batches before trying again.'},503)}}
