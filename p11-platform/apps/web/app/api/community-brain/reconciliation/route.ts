import {z}from'zod'
import {brainActor,brainRpc,resolveCommunityScope}from'@/utils/community-brain/server'
import {boundedJson,brainFailure,privateHeaders,requireConsoleOrigin}from'@/utils/community-brain/http'
export const dynamic='force-dynamic'
export async function GET(request:Request){try{
 const p=new URL(request.url).searchParams,propertyId=z.uuid().parse(p.get('propertyId')),offset=z.coerce.number().int().min(0).max(100000).parse(p.get('offset')??0)
 const scope=await resolveCommunityScope(await brainActor(),propertyId,'manage')
 return Response.json(await brainRpc('brain_replay_catalog',{p_scope_id:scope.id,p_offset:offset}),{headers:privateHeaders})
}catch(e){return brainFailure(e)}}
export async function POST(request:Request){try{
 requireConsoleOrigin(request)
 const input=z.object({propertyId:z.uuid(),requestId:z.uuid(),records:z.array(z.object({kind:z.enum(['knowledge_materials','content_assets','property_intelligence_documents','competitor_content_chunks']),id:z.uuid(),source_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1).max(100)}).strict().parse(await boundedJson(request,40000))
 const scope=await resolveCommunityScope(await brainActor(),input.propertyId,'manage')
 return Response.json(await brainRpc('brain_replay_sources',{p_scope_id:scope.id,p_id:input.requestId,p_records:input.records}),{headers:privateHeaders})
}catch(e){return brainFailure(e)}}
