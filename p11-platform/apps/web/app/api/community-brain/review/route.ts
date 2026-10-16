import {z} from 'zod'
import {brainActor,brainRpc,resolveCommunityScope,requireCurrentScope} from '@/utils/community-brain/server'
import {BrainError} from '@/utils/community-brain/contracts'
import {boundedJson,brainFailure,privateHeaders,requireConsoleOrigin} from '@/utils/community-brain/http'
import {createServiceClient} from '@/utils/supabase/admin'
import {readMaterials} from '@/utils/knowledge/material-store'
export const dynamic='force-dynamic'
const source=z.object({operation:z.literal('source'),propertyId:z.guid(),versionId:z.guid(),review:z.object({audience:z.enum(['public','internal']),origin:z.enum(['original','generated','derived']),allowedUses:z.array(z.enum(['fact','style','research'])).min(1),purposes:z.array(z.enum(['chat','site','social','brand','research','portfolio'])).min(1),reviewAfter:z.iso.datetime(),expiresAt:z.iso.datetime().nullable(),reason:z.string().min(3).max(2000)}).strict()}).strict()
const asset=z.object({operation:z.literal('asset'),propertyId:z.guid(),requestId:z.guid(),asset:z.object({fileId:z.guid(),originalHash:z.string().regex(/^[a-f0-9]{64}$/),renditionId:z.guid().nullable(),role:z.enum(['floorplan','primary_logo','secondary_logo','font','gallery','hero','interior','exterior','amenity','brand_mark']),name:z.string().trim().min(1).max(255),description:z.string().max(2000),isGenerated:z.boolean(),rights:z.enum(['owned','licensed']),license:z.string().max(2000),unitId:z.guid().nullable(),unitHash:z.string().regex(/^[a-f0-9]{64}$/).nullable(),reason:z.string().min(3).max(2000),confirmed:z.literal(true)}).strict()}).strict()
export async function GET(request:Request){try{
 const actor=await brainActor(),p=new URL(request.url).searchParams,propertyId=z.guid().parse(p.get('propertyId')),scope=await resolveCommunityScope(actor,propertyId,'research')
 if(p.get('fileId'))return Response.json(await brainRpc('brain_file_detail',{p_scope_id:scope.id,p_file_id:z.guid().parse(p.get('fileId'))}),{headers:privateHeaders})
 if(p.get('materialId')){
  const material=await readMaterials(actor,propertyId,{kind:'version',materialId:z.guid().parse(p.get('materialId')),versionId:z.guid().parse(p.get('versionId'))})
  await requireCurrentScope(scope,propertyId)
  return Response.json(material,{headers:privateHeaders})
 }
 const db=createServiceClient(),[files,materials,health]=await Promise.all([
  db.from('knowledge_files').select('id,input,state,latest_extraction_id,accepted_version_id,created_at').eq('property_id',propertyId).order('created_at',{ascending:false}).limit(100),
  db.from('knowledge_materials').select('id,latest_version_id,active_version_id,updated_at').eq('property_id',propertyId).order('updated_at',{ascending:false}).limit(100),
  brainRpc('brain_operational_status',{p_scope_id:scope.id})])
 if(files.error||materials.error)throw new BrainError('Community intake could not be read.')
 await requireCurrentScope(scope,propertyId)
 return Response.json({files:files.data,materials:materials.data,health,limit:100},{headers:privateHeaders})
}catch(error){return brainFailure(error)}}
export async function POST(request:Request){try{
 requireConsoleOrigin(request);const actor=await brainActor(),p=z.discriminatedUnion('operation',[source,asset]).safeParse(await boundedJson(request));if(!p.success)throw new BrainError('Review the source identity, intended use, and rights.',400)
 const input=p.data,scope=await resolveCommunityScope(actor,input.propertyId,'manage')
 const result=input.operation==='source'?await brainRpc('brain_review_source',{p_scope_id:scope.id,p_version_id:input.versionId,p_review:input.review}):await brainRpc('brain_review_asset',{p_scope_id:scope.id,p_id:input.requestId,p_input:input.asset})
 return Response.json(result,{headers:privateHeaders})
}catch(error){return brainFailure(error)}}
