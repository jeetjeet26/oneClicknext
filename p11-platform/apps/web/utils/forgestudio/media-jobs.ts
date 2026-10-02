import {createHash} from 'node:crypto'
import {experimental_generateVideo as generateVideo,generateImage,generateText} from 'ai'
import {createServiceClient} from '@/utils/supabase/admin'
import type {Tables} from '@/types/supabase'
import {ContentStoreError} from './content-store'
import {inspectAssetFile} from './asset-library-store'
import {FORGESTUDIO_MODEL_POLICY_VERSION,forgeStudioGatewayOptions,resolveForgeStudioImageModel,resolveForgeStudioVideoModel,type ForgeStudioImageTier,type ForgeStudioVideoTier} from './model-policy'
export const MEDIA_JOB_DOMAIN='forgestudio.media'
export const MEDIA_RESULT_BUCKET='forgestudio-media-results'
type ObjectValue=Record<string,unknown>
type MediaRequest=Tables<'forgestudio_media_requests'>
export type MediaAspectRatio = '1:1' | '4:3' | '3:4' | '16:9' | '9:16'

export type MediaJobRequest =
  | {
      modality: 'image'
      prompt: string
      tier: ForgeStudioImageTier
      aspectRatio: MediaAspectRatio
      sourceAssetId?: string | null
      altText: string
      name: string
      maxCostUsd: number
    }
  | {
      modality: 'video'
      prompt: string
      tier: ForgeStudioVideoTier
      aspectRatio: Extract<MediaAspectRatio, '16:9' | '9:16'>
      sourceAssetId?: string | null
      altText: string
      name: string
      durationSeconds: 4 | 8
      generateAudio: boolean
      maxCostUsd: number
    }

export type StoredMediaPayload = MediaJobRequest & {
  actorId: string
  sourceImageUrl: string | null
  model: string
  estimatedCostUsd: number
  modelPolicyVersion: string
}

export function estimateMediaCost(request: MediaJobRequest): number {
  if (request.modality === 'image') {
    return {
      iterative: 0.067,
      draft: 0.02,
      final: 0.04,
      premium: 0.06,
      challenger: 0.08,
    }[request.tier]
  }
  const perSecond = {
    preview: request.generateAudio ? 0.05 : 0.03,
    social: request.generateAudio ? 0.15 : 0.1,
    premium: request.generateAudio ? 0.4 : 0.2,
  }[request.tier]
  return perSecond * request.durationSeconds
}


export async function mediaRpc(name:string,args:ObjectValue,allowed?:string[]):Promise<ObjectValue>{
 const client=createServiceClient() as unknown as {rpc:(name:string,args:ObjectValue)=>Promise<{data:ObjectValue|null;error:unknown}>}
 const {data,error}=await client.rpc(name,args)
 if(error||!data)throw new ContentStoreError('The saved media result could not be confirmed. Reload the request before continuing.',503)
 if(allowed&&!allowed.includes(String(data.state)))throw new ContentStoreError(({source_unavailable:'Choose an approved, active image with a secure file link.',stale_request:'This media request changed. Reload its saved status before deciding.',stopped:'This request was stopped. Its late result remains retained and cannot be added to the library.',result_required:'No recoverable generated file is saved for this request.',request_conflict:'This request differs from the saved request. Reload your media history.',forbidden:'Your current access does not allow this media decision.'} as Record<string,string>)[String(data.state)]||'This saved media request needs review. Reload its status.',data.state==='forbidden'?403:409)
 return data
}
export async function enqueueMediaGeneration(input:{requestId:string;orgId:string;propertyId:string;actorId:string;request:MediaJobRequest}){
 const estimatedCostUsd=estimateMediaCost(input.request)
 if(estimatedCostUsd>input.request.maxCostUsd)throw new ContentStoreError(`Estimated media cost $${estimatedCostUsd.toFixed(2)} exceeds the request ceiling $${input.request.maxCostUsd.toFixed(2)}`,400)
 const result=await mediaRpc('begin_forgestudio_media',{p_id:input.requestId,p_property_id:input.propertyId,p_actor_id:input.actorId,p_input:{request:input.request,model:input.request.modality==='image'?resolveForgeStudioImageModel(input.request.tier):resolveForgeStudioVideoModel(input.request.tier),estimatedCostUsd,modelPolicyVersion:FORGESTUDIO_MODEL_POLICY_VERSION}},['saved','replayed'])
 return {id:String(result.jobId),state:'saved',estimatedCostUsd:result.estimatedCostUsd}
}
async function persistManifest(args:ObjectValue){
 // Only the identical database receipt is retried. The model is never retried.
 let failure:unknown
 for(let i=0;i<2;i++){try{return await mediaRpc('advance_forgestudio_media',args,['saved','replayed'])}catch(error){failure=error}}
 throw failure
}
async function generateImageBytes(
  payload: StoredMediaPayload,
  propertyId: string
): Promise<{
  bytes: Uint8Array
  mediaType: string
  warnings: unknown[]
  providerMetadata: Record<string, unknown>
}> {
  const gateway = forgeStudioGatewayOptions({
    propertyId,
    actorId: payload.actorId,
    operation: 'image',
    tier: payload.tier,
  })

  if (payload.tier === 'iterative') {
    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; image: URL }
    > = [{ type: 'text', text: payload.prompt }]
    if (payload.sourceImageUrl) {
      content.push({
        type: 'image',
        image: new URL(payload.sourceImageUrl),
      })
    }
    const result = await generateText({
      model: payload.model,
      messages: [{ role: 'user', content }],
      providerOptions: { gateway },
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(180_000),
    })
    const image = result.files.find((file) => file.mediaType.startsWith('image/'))
    if (!image) throw new Error('Image model returned no image file')
    return {
      bytes: image.uint8Array,
      mediaType: image.mediaType,
      warnings: result.warnings ?? [],
      providerMetadata: (result.providerMetadata ?? {}) as Record<string, unknown>,
    }
  }

  const result = await generateImage({
    model: payload.model,
    prompt: payload.prompt,
    aspectRatio: payload.aspectRatio,
    providerOptions: { gateway },
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(180_000),
  })
  return {
    bytes: result.image.uint8Array,
    mediaType: result.image.mediaType,
    warnings: result.warnings ?? [],
    providerMetadata: (result.providerMetadata ?? {}) as Record<string, unknown>,
  }
}


type Manifest={contentHash:string;size:number;mimeType:string;extension:string;width:number|null;height:number|null}
function privatePath(run:MediaRequest){return `${run.property_id}/media/${run.id}/result`}
async function verifiedBytes(bucket:string,path:string,manifest:Manifest){
 const {data,error}=await createServiceClient().storage.from(bucket).download(path)
 if(error||!data||data.size!==manifest.size)throw new ContentStoreError('The generated file is not yet confirmed in storage. Reload the saved request; recovery never starts another generation.',409)
 const bytes=Buffer.from(await data.arrayBuffer())
 if(createHash('sha256').update(bytes).digest('hex')!==manifest.contentHash)throw new ContentStoreError('The stored file differs from the saved generation result. This request needs review.',409)
 return bytes
}
async function storeOnce(bucket:string,path:string,bytes:Buffer,manifest:Manifest){
 const {error}=await createServiceClient().storage.from(bucket).upload(path,bytes,{contentType:manifest.mimeType,upsert:false})
 if(error)await verifiedBytes(bucket,path,manifest)
}
async function loadMedia(id:string,propertyId:string,orgId?:string,actorId?:string){
 const {data,error}=await createServiceClient().from('forgestudio_media_requests').select('*').eq('id',id).eq('property_id',propertyId).single()
 if(error||!data)throw new ContentStoreError('Saved media request unavailable. Reload and try again.',503)
 if(orgId&&data.org_id!==orgId)throw new ContentStoreError('This request belongs to the property’s previous organization.',403)
 if(orgId&&actorId){
  const db=createServiceClient(),[{data:property,error:propertyError},{data:actor,error:actorError}]=await Promise.all([db.from('properties').select('org_id').eq('id',propertyId).single(),db.from('profiles').select('org_id').eq('id',actorId).single()])
  if(propertyError||actorError)throw new ContentStoreError('Current media access could not be confirmed. Reload before recovery.',503)
  if(property?.org_id!==orgId||actor?.org_id!==orgId)throw new ContentStoreError('Current property access changed. This generated file remains retained for review.',403)
 }
 return data
}
async function storageEvidence(run:MediaRequest){
 if(run.state!=='result_ready'||!run.result_manifest)throw new ContentStoreError('This request has no generated file that can be recovered into the library.',409)
 const manifest=run.result_manifest as unknown as Manifest
 const bytes=await verifiedBytes(MEDIA_RESULT_BUCKET,privatePath(run),manifest)
 const path=`${run.property_id}/forgestudio/generated/${run.id}.${manifest.extension}`
 await storeOnce('property-assets',path,bytes,manifest)
 return {contentHash:manifest.contentHash,storagePath:path,storageBucket:'property-assets',storageVerified:true,fileUrl:createServiceClient().storage.from('property-assets').getPublicUrl(path).data.publicUrl}
}
export async function recoverMediaGeneration(input:{requestId:string;jobId:string;propertyId:string;orgId:string;actorId:string;expectedUpdatedAt:string;reason:string}){
 const decision={jobId:input.jobId,action:'recover',expectedUpdatedAt:input.expectedUpdatedAt,reason:input.reason},args={p_id:input.requestId,p_property_id:input.propertyId,p_actor_id:input.actorId}
 const prior=await mediaRpc('forgestudio_command_start',{...args,p_kind:'media.recovered',p_payload:decision},['new','replayed'])
 if(prior.state==='replayed')return prior
 const run=await loadMedia(input.jobId,input.propertyId,input.orgId,input.actorId)
 if(new Date(run.updated_at).getTime()!==new Date(input.expectedUpdatedAt).getTime())throw new ContentStoreError('This media request changed. Reload its saved status before deciding.',409)
 const storage=await storageEvidence(run)
 return mediaRpc('decide_forgestudio_media',{...args,p_payload:{...decision,storage:{...storage,origin:'console_recovery'}}},['saved','replayed'])
}
async function executeMediaJob(run:MediaRequest){
 const input=run.input as unknown as {request:MediaJobRequest;model:string;estimatedCostUsd:number;modelPolicyVersion:string}
 const payload={...input.request,actorId:run.actor_id!,sourceImageUrl:(run.source_snapshot as {file_url?:string}|null)?.file_url??null,model:input.model,estimatedCostUsd:input.estimatedCostUsd,modelPolicyVersion:input.modelPolicyVersion} as StoredMediaPayload
 const step=(action:string,payload:ObjectValue)=>({p_id:run.id,p_claim_token:run.claim_token,p_action:action,p_payload:payload})
 let invoked=false,manifestSaved=false
 try{
  if(process.env.OUTBOUND_DELIVERY_PAUSED==='true')return {jobId:run.id,state:'paused'}
  const permission=await mediaRpc('advance_forgestudio_media',step('model_intent',{}))
  if(permission.state!=='proceed_once'){
   if(['source_changed','access_changed'].includes(String(permission.state)))await mediaRpc('advance_forgestudio_media',step('failure',{code:permission.state}))
   return {jobId:run.id,state:permission.state}
  }
  invoked=true
  let generated:{bytes:Uint8Array;mediaType:string;warnings:unknown[];providerMetadata:Record<string,unknown>}
  if(payload.modality==='image')generated=await generateImageBytes(payload,run.property_id)
  else{
   const result=await generateVideo({model:payload.model,prompt:payload.sourceImageUrl?{image:payload.sourceImageUrl,text:payload.prompt}:payload.prompt,duration:payload.durationSeconds,aspectRatio:payload.aspectRatio,generateAudio:payload.generateAudio,providerOptions:{gateway:forgeStudioGatewayOptions({propertyId:run.property_id,actorId:payload.actorId,operation:'video',tier:payload.tier})},headers:{'idempotency-key':run.id},poll:{intervalMs:5_000,timeoutMs:210_000},maxRetries:0,abortSignal:AbortSignal.timeout(240_000)})
   if(!result.videos[0])throw new Error('No video file returned')
   generated={bytes:result.videos[0].uint8Array,mediaType:result.videos[0].mediaType,warnings:result.warnings??[],providerMetadata:(result.providerMetadata??{}) as Record<string,unknown>}
  }
  const file=new File([new Uint8Array(generated.bytes)],'generated',{type:generated.mediaType}),inspected=await inspectAssetFile(file)
  if((payload.modality==='video')!==(inspected.asset_type==='video'))throw new Error('Generated file type differs from the request')
  const manifest:Manifest={contentHash:inspected.contentHash,size:file.size,mimeType:file.type,extension:inspected.extension,width:inspected.width,height:inspected.height}
  await persistManifest(step('result_manifest',{...manifest}));manifestSaved=true
  // Private bytes are retained even when stop won the race. They are never applied after stop.
  await storeOnce(MEDIA_RESULT_BUCKET,privatePath(run),inspected.bytes,manifest)
  const current=await loadMedia(run.id,run.property_id,run.org_id,run.actor_id??undefined)
  if(current.state==='stopped')return {jobId:run.id,state:'stopped'}
  const storage=await storageEvidence(current)
  const result=await mediaRpc('finish_forgestudio_media',{p_id:run.id,p_property_id:run.property_id,p_actor_id:run.actor_id,p_payload:storage},['saved','replayed','stopped'])
  return {jobId:run.id,...result}
 }catch(error){
  if(!manifestSaved)await mediaRpc('advance_forgestudio_media',step('failure',{code:invoked?'model_uncertain':'preparation_failed'})).catch(()=>undefined)
  return {jobId:run.id,state:manifestSaved?'result_ready':'review_required',error:error instanceof Error?error.message:'Media request needs review'}
 }
}
export async function processDueMediaJobs(input:{workerId:string;limit?:number}):Promise<{claimed:number;results:Array<ObjectValue>;paused?:boolean}>{
 if(process.env.OUTBOUND_DELIVERY_PAUSED==='true')return {claimed:0,results:[],paused:true}
 // One bounded model call per cron invocation fits the route's runtime budget.
 const claimed=await mediaRpc('claim_forgestudio_media',{p_worker:input.workerId})
 if(claimed.state==='empty')return {claimed:0,results:[]}
 if(claimed.state!=='claimed')throw new ContentStoreError('Media work could not be claimed.',503)
 return {claimed:1,results:[await executeMediaJob(claimed.request as MediaRequest)]}
}
