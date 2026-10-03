import {createServiceClient} from '@/utils/supabase/admin'
import {assembleForgeStudioContext} from './context-assembler'
import {GENERATION_PROMPT_VERSION,generateRevisionContent,generationOutputSchema,materializeGeneration,type GenerationInput,type GenerationResult} from './generation'
import {CONTENT_CONTRACT_VERSION,formatPlanItemSchema,SOCIAL_PLATFORMS,validateVariant,revisionContentSchema,type SocialPlatform} from './content-contract'
import {FORGESTUDIO_MODEL_POLICY_VERSION,resolveForgeStudioTextModel} from './model-policy'
import {ContentStoreError} from './content-store'
import type {Tables} from '@/types/supabase'
type ObjectValue=Record<string,unknown>
export async function generationRpc(name:string,args:ObjectValue):Promise<ObjectValue>{
 const client=createServiceClient() as unknown as {rpc:(name:string,args:ObjectValue)=>Promise<{data:ObjectValue|null;error:unknown}>}
 const {data,error}=await client.rpc(name,args)
 if(error||!data)throw new ContentStoreError('Generation state could not be confirmed. Reload the saved request before continuing.',503)
 return data
}
function ensure(result:ObjectValue,states:string[]=['saved','replayed']){
 if(!states.includes(String(result.state)))throw new ContentStoreError(`The saved generation needs review (${result.state}). Reload its status.`,409)
 return result
}
async function persist(name:string,args:ObjectValue){
 // A retry only repeats the identical saved receipt; it never repeats model work.
 let failure:unknown
 for(let count=0;count<2;count++){try{return ensure(await generationRpc(name,args))}catch(error){failure=error}}
 throw failure
}
export async function recoverGeneration(id:string,propertyId:string,actorId:string,recoveryRequestId?:string){
 const {data:run,error}=await createServiceClient().from('forgestudio_generations').select('*').eq('id',id).eq('property_id',propertyId).single()
 if(error||!run)throw new ContentStoreError('Generation request not found',404)
 if(run.state==='completed'&&!recoveryRequestId)return {state:'replayed',packageId:run.package_id,revisionId:run.revision_id}
 if(!['result_ready','completed'].includes(run.state)||!run.raw_result||!run.model_input)throw new ContentStoreError('No recoverable model result is saved. Reload the request status.',409)
 const raw=run.raw_result as unknown as {output:unknown;metadata:GenerationResult['metadata']}
 const input=run.model_input as unknown as GenerationInput & {promptVersion?:string}
 const savedVersion=input.promptVersion??'forgestudio.generation.v1'
 if(!['forgestudio.generation.v1',GENERATION_PROMPT_VERSION].includes(savedVersion)||raw.metadata.promptVersion!==savedVersion||raw.metadata.contractVersion!==CONTENT_CONTRACT_VERSION||(savedVersion==='forgestudio.generation.v1'&&input.bundle.channelSettings))throw new ContentStoreError('This saved result uses an unrecognized or inconsistent generation contract and needs review.',409)
 const generated=materializeGeneration(input,generationOutputSchema.parse(raw.output),raw.metadata)
 const content=revisionContentSchema.parse(generated.content)
 return ensure(await generationRpc(recoveryRequestId?'recover_forgestudio_generation':'finish_forgestudio_generation',{p_id:recoveryRequestId||id,p_property_id:propertyId,p_actor_id:actorId,p_payload:{generationId:id,resultHash:run.raw_result_hash,content,validation:content.variants.map(validateVariant)}}))
}
export async function runBriefGeneration(input:{requestId:string;briefId:string;propertyId:string;actorId:string}){
 const started=await generationRpc('begin_forgestudio_generation',{p_id:input.requestId,p_property_id:input.propertyId,p_actor_id:input.actorId,p_brief_id:input.briefId})
 if(started.state!=='claimed')return started
 const token=String(started.claimToken),brief=started.brief as Tables<'social_content_briefs'>
 const step=(action:string,payload:ObjectValue)=>({p_id:input.requestId,p_claim_token:token,p_action:action,p_payload:payload})
 let invoked=false,resultSaved=false
 try{
  const channels=(brief.channels??[]).filter((c):c is SocialPlatform=>(SOCIAL_PLATFORMS as readonly string[]).includes(c))
  if(!channels.length)throw new ContentStoreError('The saved brief needs at least one valid channel.',400)
  const formatPlan=formatPlanItemSchema.array().min(1).parse(brief.format_plan)
  const bundle=await assembleForgeStudioContext({propertyId:input.propertyId,query:[brief.objective,brief.topic].filter(Boolean).join(' — '),sourceFacts:(brief.source_facts??[]) as Array<{text:string;source?:string}>,assetIds:brief.asset_ids??[]})
  if((brief.asset_ids??[]).some(id=>!bundle.assets.some(asset=>asset.id===id)))throw new ContentStoreError('A selected asset is unavailable or needs approval. Review the library and update the brief before generating.',409)
  const savedInput={bundle,objective:brief.objective,topic:brief.topic,audience:brief.audience,constraints:(brief.constraints??{}) as ObjectValue,channels,formatPlan,actorId:input.actorId,model:resolveForgeStudioTextModel(),promptVersion:GENERATION_PROMPT_VERSION,modelPolicyVersion:FORGESTUDIO_MODEL_POLICY_VERSION}
  await persist('advance_forgestudio_generation',step('context',savedInput))
  const permission=await generationRpc('advance_forgestudio_generation',step('model_intent',{}))
  ensure(permission,['proceed_once'])
  invoked=true
  await generateRevisionContent({...savedInput,onResult:async result=>{await persist('advance_forgestudio_generation',step('raw_result',result));resultSaved=true}})
  return await recoverGeneration(input.requestId,input.propertyId,input.actorId)
 }catch(error){
  // Lost input/intent/result acknowledgements retain their evidence. The same
  // request never re-enters this branch after begin returns an existing state.
  if(!resultSaved)await generationRpc('advance_forgestudio_generation',step('failure',{code:invoked?'model_uncertain':'context_failed'})).catch(()=>undefined)
  throw error
 }
}
