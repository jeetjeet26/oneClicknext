import {z} from 'zod'
import {brainActor,brainRpc,resolveCommunityScope} from '@/utils/community-brain/server'
import {BrainError} from '@/utils/community-brain/contracts'
import {boundedJson,brainFailure,privateHeaders,requireConsoleOrigin} from '@/utils/community-brain/http'
import {loadPackageSource} from '@/utils/siteforge/packages/source'
import {readServiceDeliverable} from '@/utils/community-brain/generation'
export const dynamic='force-dynamic'
const text=z.string().trim().min(1).max(2000),record=z.record(z.string(),z.unknown())
const requestSchema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('initiative'),propertyId:z.uuid(),requestId:z.uuid(),input:z.object({name:text,offering:text,objective:text,successMetric:text,baseline:record,start:z.iso.date(),end:z.iso.date(),stopConditions:z.array(text).min(1).max(20)}).strict()}).strict(),
 z.object({operation:z.literal('package'),propertyId:z.uuid(),requestId:z.uuid(),initiativeId:z.uuid(),input:z.object({previousId:z.uuid().nullable(),state:z.enum(['draft','approved','withdrawn']),aiBudgetUsd:z.number().min(0).max(100000),brief:z.object({goal:text,channels:z.array(text).min(1).max(20),deliverables:z.array(text).min(1).max(50),requirements:text,reviewCriteria:text}).strict()}).strict()}).strict(),
 z.object({operation:z.literal('deliverable'),propertyId:z.uuid(),requestId:z.uuid(),packageId:z.uuid(),purpose:z.enum(['site','social','brand','chat']),query:z.string().max(4000).default(''),assetIds:z.array(z.uuid()).max(100).default([]),requirements:record,outputContract:record,reviewCriteria:record}).strict(),
])
export async function GET(request:Request){try{
 const p=new URL(request.url).searchParams,actor=await brainActor(),propertyId=z.uuid().parse(p.get('propertyId'))
 if(p.get('deliverableId'))return Response.json(await readServiceDeliverable(actor,propertyId,z.enum(['site','social','brand','chat']).parse(p.get('purpose')),z.uuid().parse(p.get('deliverableId'))),{headers:privateHeaders})
 const scope=await resolveCommunityScope(actor,propertyId,'research')
 return Response.json(await brainRpc('brain_read_coordination',{p_scope_id:scope.id}),{headers:privateHeaders})
}catch(error){return brainFailure(error)}}
export async function POST(request:Request){try{
 requireConsoleOrigin(request);const actor=await brainActor(),parsed=requestSchema.safeParse(await boundedJson(request,64000));if(!parsed.success)throw new BrainError('Review the initiative, package, and selected deliverable.',400)
 const input=parsed.data,scope=await resolveCommunityScope(actor,input.propertyId,input.operation==='deliverable'?input.purpose:'manage')
 let result:unknown
 if(input.operation==='initiative')result=await brainRpc('brain_save_initiative',{p_scope_id:scope.id,p_id:input.requestId,p_input:input.input})
 else if(input.operation==='package')result=await brainRpc('brain_save_package',{p_scope_id:scope.id,p_id:input.requestId,p_initiative_id:input.initiativeId,p_input:input.input})
 else {
  // Site packages include all required exact drawings, logos and fonts. The same
  // selection is retained in the portable brief and the native generator.
  const site=input.purpose==='site'?await loadPackageSource(input.propertyId,actor,input.assetIds.length?input.assetIds:undefined):null
  result=await brainRpc('brain_prepare_deliverable',{p_scope_id:scope.id,p_id:input.requestId,p_package_id:input.packageId,p_query:site?'community facts amenities policies brand floorplans':input.query,p_asset_ids:site?site.source.assets.map(a=>a.id):input.assetIds,p_requirements:input.requirements,p_output:input.outputContract,p_review:input.reviewCriteria})
 }
 return Response.json(result,{headers:privateHeaders})
}catch(error){return brainFailure(error)}}
