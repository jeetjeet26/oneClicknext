import {createServiceClient} from '@/utils/supabase/admin'
import {MarketStoreError} from './decision-store'
import {prepareBrandEvidence,executeBrandEvidence,parseBrandEvidence,type BrandModelInput,type BrandModelReceipt} from './brand-evidence-model'
import type {BrandRequest} from './brand-evidence-contracts'
import type {z} from 'zod'
type RecordValue=Record<string,unknown>
const messages:Record<string,string>={source_unavailable:'The retained page no longer matches this competitor. Capture and review its current source.',forbidden:'This property is unavailable.',not_found:'This brand request is unavailable in the selected property.',stale_source:'The retained page changed. Reload it before requesting analysis.',stale_request:'This request changed. Reload its saved status.',stale_preview:'The original preview changed. Reload the saved request.',stale_review:'Another brand review was saved. Reload and review the current evidence before replacing it.',request_conflict:'This decision differs from the saved request. Inspect its history.',closed_request:'This brand request is already closed.',preview_required:'A complete saved preview is required.',review_not_current:'This review is no longer the current saved evidence.',cursor_changed:'Reload brand history before loading another page.',source_too_large:'The complete page exceeds the supported analysis size.'}
export async function brandRpc(name:string,args:RecordValue,allowed=['ready','saved','replayed','queued','running','result_ready','preview_ready','held','stopped','completed','busy','invoke_once']){const db=createServiceClient() as unknown as{rpc:(name:string,args:RecordValue)=>Promise<{data:RecordValue|null;error:unknown}>};const {data,error}=await db.rpc(name,args);if(error||!data)throw new MarketStoreError('The brand decision could not be confirmed. Retry the same decision or inspect saved history.');if(!allowed.includes(String(data.state)))throw new MarketStoreError(messages[String(data.state)]||'Review the current brand state before continuing.',data.state==='forbidden'?403:data.state==='not_found'?404:409);return data}
export async function requestBrandEvidence(input:z.infer<typeof BrandRequest>,actor:string){
 const {requestId,propertyId,...source}=input,db=createServiceClient()
 const prior=await db.from('marketvision_brand_requests').select('id').eq('id',requestId).eq('property_id',propertyId).maybeSingle()
 if(prior.error)throw new MarketStoreError('Saved brand requests could not be loaded.')
 if(prior.data)return brandRpc('begin_marketvision_brand',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:source,p_model_input:{}})
 const {data:captured,error}=await db.from('marketvision_source_requests').select('state,version,raw_result,source_snapshot').eq('id',source.sourceId).eq('property_id',propertyId).eq('competitor_id',source.competitorId).maybeSingle()
 if(error)throw new MarketStoreError('Saved source evidence could not be loaded.')
 if(!captured||captured.state!=='received')throw new MarketStoreError(messages.source_unavailable,409)
 if(captured.version!==source.sourceVersion)throw new MarketStoreError('The saved page changed. Reload it before requesting analysis.',409)
 const receipt=captured.raw_result as {text:string;finalUrl:string}
 const competitor=await db.from('competitors').select('name').eq('id',source.competitorId).eq('property_id',propertyId).single()
 if(competitor.error)throw new MarketStoreError('The selected competitor could not be loaded.')
 let model:BrandModelInput;try{model=prepareBrandEvidence(receipt.text,receipt.finalUrl,competitor.data.name)}catch{throw new MarketStoreError('The complete source is outside the supported analysis size. Choose a smaller complete page.',409)}
 return brandRpc('begin_marketvision_brand',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:source,p_model_input:model})
}
export async function buildBrandEvidencePreview(id:string){const {data:run,error}=await createServiceClient().from('marketvision_brand_requests').select('id,state,model_input,raw_result,result_hash').eq('id',id).maybeSingle();if(error||!run)throw new MarketStoreError('The saved brand receipt could not be loaded.');if(run.state!=='result_ready')return {state:run.state}
 let preview:unknown=null,errorCode:string|null=null;try{preview=parseBrandEvidence(run.model_input as unknown as BrandModelInput,run.raw_result as unknown as BrandModelReceipt)}catch(e){errorCode=e instanceof Error&&e.message==='incomplete_output'?'incomplete_output':'invalid_output'}
 return brandRpc('prepare_marketvision_brand_preview',{p_id:id,p_result_hash:run.result_hash,p_preview:preview,p_error_code:errorCode})
}
export function brandExecutionStatus(){return {paused:process.env.OUTBOUND_DELIVERY_PAUSED==='true',configured:!!process.env.OPENAI_API_KEY}}
export async function runBrandEvidence(id:string){const status=brandExecutionStatus();if(status.paused)return {state:'paused'};if(!status.configured)return {state:'provider_unavailable'};const claim=await brandRpc('claim_marketvision_brand',{p_id:id});if(claim.state==='result_ready')return buildBrandEvidencePreview(id);if(claim.state!=='invoke_once')return claim
 let receipt:BrandModelReceipt;try{receipt=await executeBrandEvidence(claim.modelInput as unknown as BrandModelInput)}catch{receipt={status:'uncertain',errorCode:'model_uncertain'}}
 const args={p_id:id,p_claim_token:claim.claimToken,p_result:receipt};let result:RecordValue;try{result=await brandRpc('record_marketvision_brand_result',args)}catch{result=await brandRpc('record_marketvision_brand_result',args)}
 return result.requestState==='result_ready'?buildBrandEvidencePreview(id):result
}
/** Receipt recovery stays local even while outbound execution is paused. */
export async function recoverBrandEvidence(id:string){const {data,error}=await createServiceClient().from('marketvision_brand_requests').select('state').eq('id',id).maybeSingle();if(error||!data)throw new MarketStoreError('Saved brand status could not be loaded.');return data.state==='result_ready'?buildBrandEvidencePreview(id):data.state==='queued'?runBrandEvidence(id):{state:data.state}}
