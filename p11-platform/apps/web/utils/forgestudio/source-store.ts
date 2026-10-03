import {createHash} from 'node:crypto'
import {createServiceClient} from '@/utils/supabase/admin'
import {ContentStoreError,editorialRpc} from './content-store'
import {assembleForgeStudioContext,type TrustedContextBundle} from './context-assembler'
import {revisionContentSchema,validateVariant,type RevisionContent} from './content-contract'

type ObjectValue=Record<string,unknown>
const rpc=async(name:string,args:ObjectValue)=>{
 const db=createServiceClient() as unknown as {rpc:(name:string,args:ObjectValue)=>Promise<{data:ObjectValue|null;error:unknown}>}
 const {data,error}=await db.rpc(name,args)
 if(error||!data)throw new ContentStoreError('Source evidence could not be confirmed. Reload the saved revision before continuing.',503)
 return data
}
function ordered(value:unknown):unknown{
 if(Array.isArray(value))return value.map(ordered)
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,ordered(v)]))
 return value
}
export const sourceReviewHash=(bundle:TrustedContextBundle)=>createHash('sha256').update(JSON.stringify(ordered({records:bundle.sourceRecords,assets:[...bundle.assets].sort((a,b)=>a.id.localeCompare(b.id)),sources:bundle.sources.filter(s=>s.kind!=='performance_signal').map(source=>({...source,recordedAt:undefined})).sort((a,b)=>a.id.localeCompare(b.id))}))).digest('hex')

async function loadRevision(packageId:string,propertyId:string){
 const db=createServiceClient()
 const {data:pkg,error}=await db.from('social_content_packages').select('id,current_revision_id').eq('id',packageId).eq('property_id',propertyId).single()
 if(error||!pkg?.current_revision_id)throw new ContentStoreError('The saved campaign could not be loaded.',503)
 const {data:revision,error:revisionError}=await db.from('social_content_revisions').select('id,content,context_snapshot_id').eq('id',pkg.current_revision_id).eq('property_id',propertyId).single()
 if(revisionError||!revision)throw new ContentStoreError('The saved revision could not be loaded.',503)
 let bundle:TrustedContextBundle|null=null
 if(revision.context_snapshot_id){
  const {data:snapshot,error:snapshotError}=await db.from('shared_context_snapshots').select('context_payload').eq('id',revision.context_snapshot_id).eq('property_id',propertyId).single()
  if(snapshotError||!snapshot)throw new ContentStoreError('The original source snapshot could not be loaded.',503)
  bundle=snapshot.context_payload as unknown as TrustedContextBundle
 }
 return {revision,bundle}
}
async function currentContext(propertyId:string,content:RevisionContent,saved:TrustedContextBundle|null,extraAssetIds:string[]=[]){
 const assetIds=[...new Set([...extraAssetIds,...content.variants.flatMap(v=>[...v.assetIds,...(v.thumbnailAssetId?[v.thumbnailAssetId]:[])])])]
 let frontier=[...assetIds]
 for(let depth=0;frontier.length;depth++){
  if(depth>=20||assetIds.length>200)throw new ContentStoreError('This asset replacement history needs review in the library.',409)
  const {data,error}=await createServiceClient().from('content_assets').select('id,replacement_asset_id').eq('property_id',propertyId).in('id',frontier)
  if(error)throw new ContentStoreError('Asset replacements could not be checked. Reload before continuing.',503)
  frontier=(data??[]).flatMap(a=>a.replacement_asset_id&&!assetIds.includes(a.replacement_asset_id)?[a.replacement_asset_id]:[])
  assetIds.push(...frontier)
 }
 const documentIds=[...new Set((saved?.sources??[]).filter(s=>s.kind==='kb_document').map(s=>s.id.slice('kb_document:'.length)))]
 // The review is deterministic. It reads the same saved document IDs and never
 // calls retrieval embeddings, text generation, media generation or providers.
 return assembleForgeStudioContext({propertyId,query:content.claims.some(c=>c.type==='testimonial')?'testimonial review':content.conceptSummary,assetIds,documentIds})
}
export async function getSourceReview(packageId:string,propertyId:string,extraAssetIds:string[]=[]){
 const {revision,bundle}=await loadRevision(packageId,propertyId)
 const content=revisionContentSchema.parse(revision.content)
 const [check,current]=await Promise.all([
  rpc('check_forgestudio_sources',{p_property_id:propertyId,p_context_id:revision.context_snapshot_id,p_content:content}),
  currentContext(propertyId,content,bundle,extraAssetIds),
 ])
 return {revisionId:revision.id,...check,previewHash:sourceReviewHash(current),currentSources:current.sources,currentAssets:current.assets,currentWarnings:current.warnings}
}
export async function refreshSourceReview(input:{requestId:string;packageId:string;propertyId:string;actorId:string;expectedRevisionId:string;previewHash:string;reason:string;content:RevisionContent;extraAssetIds?:string[]}){
 const payload={extraAssetIds:input.extraAssetIds??[],packageId:input.packageId,expectedRevisionId:input.expectedRevisionId,previewHash:input.previewHash,reason:input.reason,content:input.content,validation:input.content.variants.map(validateVariant)}
 // Check saved identity first: a lost response must return the original result,
 // even if evidence or the current revision changed after that successful save.
 const saved=await rpc('forgestudio_command_start',{p_id:input.requestId,p_property_id:input.propertyId,p_actor_id:input.actorId,p_kind:'sources.refreshed',p_payload:payload})
 if(saved.state==='replayed')return saved
 if(saved.state!=='new')throw new ContentStoreError('This source review differs from the saved request or your access changed. Reload the saved work.',409)
 const {revision,bundle}=await loadRevision(input.packageId,input.propertyId)
 if(revision.id!==input.expectedRevisionId)throw new ContentStoreError('The revision changed. Reload its source review.',409)
 // Use the original variant selection when checking the preview; edited content
 // may detach media but cannot silently introduce an unreviewed asset.
 const current=await currentContext(input.propertyId,revisionContentSchema.parse(revision.content),bundle,input.extraAssetIds??[])
 if(sourceReviewHash(current)!==input.previewHash)throw new ContentStoreError('The sources changed after this preview. Reload sources and review the latest values.',409)
 return editorialRpc('refresh_forgestudio_sources',input.requestId,input.propertyId,input.actorId,{...payload,bundle:current})
}
