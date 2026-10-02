import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {crmRpc} from '@/utils/crm/workspace'
const guid=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const common={propertyId:guid,requestId:z.string().uuid()}
const schema=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('save'),platform:z.enum(['yardi','realpage','salesforce','hubspot','lasso']),revision:z.number().int().nonnegative(),credentials:z.record(z.string().max(80),z.string().max(8192)).nullable(),mapping:z.record(z.string().max(80),z.string().trim().max(128))}).strict(),
 z.object({...common,action:z.literal('preview'),integrationId:guid,revision:z.number().int().positive(),leadId:guid.nullable()}).strict(),
 z.object({...common,action:z.literal('approve'),previewId:guid}).strict(),
])
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}})
function result(data:Record<string,unknown>) {
 const ok=['saved','applied','replayed'].includes(String(data.state))
 const messages:Record<string,string>={unfinished_test:'Recover the unfinished provider test and confirm cleanup before changing this connection.',unfinished_delivery:'Resolve the uncertain CRM transfer before changing this connection.',stale:'The saved configuration changed. Reload it before continuing.',stale_preview:'The lead changed after this preview. Create a fresh preview before approving.',credentials_required:'Enter credentials for this new connection.',duplicate_targets:'Map each source to a different CRM field.',mapping_required:'Save at least one field mapping before previewing.',identity_mapping_required:'Map email or phone before approving so leads can be identified.',provider_change_requires_review:'This property already has another CRM entry. Its replacement must be reviewed before saving a different provider.',request_conflict:'This request differs from its saved version. Reload the saved configuration.'}
 return json(ok?data:{...data,error:messages[String(data.state)] || 'This CRM request is unavailable for your current access.'},ok?200:data.state==='forbidden'?403:data.state==='not_found'?404:409)
}
async function user(){const client=await createClient();const {data:{user},error}=await client.auth.getUser();return error?null:user}
export async function GET(req:NextRequest){try{
 const actor=await user();if(!actor)return json({error:'Unauthorized'},401)
 const property=guid.safeParse(req.nextUrl.searchParams.get('propertyId'));if(!property.success)return json({error:'A valid property is required.'},400)
 return result(await crmRpc('read_crm_workspace',{p_property_id:property.data,p_actor_id:actor.id}))
}catch{return json({error:'Saved CRM setup could not be loaded. Try again.'},503)}}
export async function POST(req:NextRequest){try{
 const actor=await user();if(!actor)return json({error:'Unauthorized'},401)
 const parsed=schema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return json({error:'A saved configuration, request identity and valid review details are required.'},400)
 const body=parsed.data,common={p_property_id:body.propertyId,p_actor_id:actor.id,p_request_id:body.requestId}
 if(body.action==='save')return result(await crmRpc('save_crm_mapping_review',{...common,p_platform:body.platform,p_revision:body.revision,p_credentials:body.credentials,p_mapping:body.mapping}))
 if(body.action==='preview')return result(await crmRpc('preview_crm_mapping',{...common,p_integration_id:body.integrationId,p_revision:body.revision,p_lead_id:body.leadId}))
 return result(await crmRpc('approve_crm_mapping',{...common,p_preview_id:body.previewId}))
}catch{return json({error:'The CRM result could not be confirmed. Reload the saved setup or retry the same request.'},503)}}
