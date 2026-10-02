import {createHash} from 'node:crypto'
import {createServiceClient} from '@/utils/supabase/admin'
import {prepareReviewAnalysis,executeSavedReviewAnalysis,parseSavedReviewAnalysis,type SavedAnalysisInput,type SavedAnalysisReceipt} from './ai'
type ObjectValue=Record<string,unknown>
export class ReviewStoreError extends Error{constructor(message:string,readonly status=503){super(message)}}
export async function reviewRpc(name:string,args:ObjectValue,allowed?:string[]):Promise<ObjectValue>{
 const db=createServiceClient() as unknown as{rpc:(name:string,args:ObjectValue)=>Promise<{data:ObjectValue|null;error:unknown}>}
 const {data,error}=await db.rpc(name,args);if(error||!data)throw new ReviewStoreError('The review result could not be confirmed. Reload its saved history before continuing.')
 if(allowed&&!allowed.includes(String(data.state)))throw new ReviewStoreError(({forbidden:'Your current access does not allow this review decision.',stale_source:'This review changed. Reload its current source before analyzing.',source_unavailable:'A saved review with readable text is required.',stale_request:'This analysis request changed. Reload its saved status.',request_conflict:'This request differs from its saved decision. Reload its history.',result_conflict:'The saved model result cannot be replaced.',result_required:'No confirmed model result is available for recovery.',not_found:'This saved review request is unavailable.'} as Record<string,string>)[String(data.state)]||'This analysis request needs review.',data.state==='forbidden'?403:409)
 return data
}
export async function requestReviewAnalysis(input:{propertyId:string;requestId:string;reviewId:string;sourceVersion:number},actorId:string){
 const db=createServiceClient(),payload={reviewId:input.reviewId,sourceVersion:input.sourceVersion}
 const prior=await db.from('reviewflow_analysis_requests').select('id').eq('id',input.requestId).eq('property_id',input.propertyId).maybeSingle();if(prior.error)throw new ReviewStoreError('Saved analysis history could not be loaded.')
 if(prior.data)return reviewRpc('begin_reviewflow_analysis',{p_id:input.requestId,p_property_id:input.propertyId,p_actor_id:actorId,p_input:payload,p_model_input:{}},['queued','running','result_ready','completed','held','stopped'])
 const {data:review,error}=await db.from('reviews').select('id,source_version,review_text,rating,platform,reviewer_name').eq('id',input.reviewId).eq('property_id',input.propertyId).maybeSingle();if(error)throw new ReviewStoreError('The current review could not be loaded.');if(!review)throw new ReviewStoreError('Review unavailable.',404);if(review.source_version!==input.sourceVersion)throw new ReviewStoreError('This review changed. Reload its current source.',409)
 const modelInput=prepareReviewAnalysis({reviewText:review.review_text??'',rating:review.rating,platform:review.platform,reviewerName:review.reviewer_name})
 return reviewRpc('begin_reviewflow_analysis',{p_id:input.requestId,p_property_id:input.propertyId,p_actor_id:actorId,p_input:payload,p_model_input:modelInput},['queued','busy','running','result_ready','completed','held','stopped'])
}
export async function recoverReviewAnalysis(id:string,propertyId:string,actorId:string){
 const {data:run,error}=await createServiceClient().from('reviewflow_analysis_requests').select('*').eq('id',id).eq('property_id',propertyId).maybeSingle();if(error)throw new ReviewStoreError('Saved analysis could not be loaded.');if(!run)throw new ReviewStoreError('Saved analysis unavailable.',404)
 if(run.state==='completed')return{state:'replayed',analysisId:run.analysis_id};if(run.state!=='result_ready')return{state:run.state}
 const input=run.model_input as unknown as SavedAnalysisInput,receipt=run.raw_result as unknown as SavedAnalysisReceipt
 let result:ObjectValue
 try{result={resultHash:run.result_hash,analysis:parseSavedReviewAnalysis(input,receipt)}}catch{result={resultHash:run.result_hash,errorCode:'invalid_output'}}
 return reviewRpc('apply_reviewflow_analysis',{p_id:id,p_property_id:propertyId,p_actor_id:actorId,p_result:result},['saved','replayed','held','stopped'])
}
export async function runSavedReviewAnalysis(id:string){
 if(process.env.OUTBOUND_DELIVERY_PAUSED==='true')return{state:'paused'}
 const claim=await reviewRpc('claim_reviewflow_analysis',{p_id:id})
 if(claim.state!=='invoke_once')return claim
 let receipt:SavedAnalysisReceipt
 try{receipt=await executeSavedReviewAnalysis(claim.modelInput as SavedAnalysisInput)}catch{receipt={status:'uncertain',errorCode:'model_uncertain'}}
 const args={p_id:id,p_claim_token:claim.claimToken,p_result:receipt};let saved:ObjectValue
 // Only receipt persistence is retried; a model invocation is never repeated.
 try{saved=await reviewRpc('record_reviewflow_analysis_result',args,['saved','replayed'])}catch{saved=await reviewRpc('record_reviewflow_analysis_result',args,['saved','replayed'])}
 if(saved.requestState!=='result_ready')return saved
 return recoverReviewAnalysis(id,String(claim.propertyId),String(claim.actorId))
}
/** Automatic import/sync analysis reuses a stable source/version/requester/contract identity; explicit reanalysis uses a new reviewed request. */
export function automaticAnalysisId(reviewId:string,version:number,actorId:string){const h=createHash('sha256').update(JSON.stringify(['reviewflow.analysis-v3',reviewId,version,actorId])).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`}
