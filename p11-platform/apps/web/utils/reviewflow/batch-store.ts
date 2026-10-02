import {createServiceClient} from '@/utils/supabase/admin'
import {reviewRpc,ReviewStoreError,runSavedReviewAnalysis,recoverReviewAnalysis} from './analysis-store'
import {prepareReviewAnalysis} from './ai'
import {batchStates} from './batch-contracts'
export async function batchRpc(name:string,args:Record<string,unknown>){const r=await reviewRpc(name,args);if(!batchStates.includes(String(r.state)))throw new ReviewStoreError(({manager_required:'A manager or admin must review this analysis queue.',forbidden:'This property is unavailable.',stale_request:'The analysis queue changed. Reload its current version.',request_conflict:'This decision differs from its saved request.',not_found:'Saved analysis queue unavailable.',scope_confirmation_required:'Confirm the exact number of selected review analyses.',already_approved:'This analysis selection is already approved. Reload its progress.'} as Record<string,string>)[String(r.state)]||'This saved analysis queue needs review.',['manager_required','forbidden'].includes(String(r.state))?403:409);return r}
export async function prepareBatch(id:string,propertyId:string,actorId:string,input:{scope:'unanalyzed_current';reason:string}){
 const {data:prior,error}=await createServiceClient().from('reviewflow_analysis_batches').select('id').eq('id',id).eq('property_id',propertyId).maybeSingle();if(error)throw new ReviewStoreError('Saved analysis queues could not be loaded.')
 let template:Record<string,unknown>={}
 if(!prior){const saved=prepareReviewAnalysis({reviewText:'',rating:null,platform:null,reviewerName:null});const {source: _source,userPrompt: _prompt,...recipe}=saved;void _source;void _prompt;template=recipe}
 return batchRpc('prepare_reviewflow_batch',{p_id:id,p_property_id:propertyId,p_actor_id:actorId,p_input:input,p_model_template:template})
}
export async function runReviewAnalysisBatch(id:string){
 const checkpoint=()=>batchRpc('checkpoint_reviewflow_batch',{p_batch_id:id})
 let result=await checkpoint();if(!['queued','running'].includes(String(result.state)))return result
 const db=createServiceClient(),{data:batch,error}=await db.from('reviewflow_analysis_batches').select('property_id,approved_by').eq('id',id).maybeSingle();if(error||!batch?.approved_by)throw new ReviewStoreError('Saved analysis authority could not be loaded.')
 const selected=await db.rpc('next_reviewflow_batch_items',{p_batch_id:id,p_limit:3});if(selected.error)throw new ReviewStoreError('Saved analysis selection could not be loaded.')
 const items=selected.data as unknown as Array<{itemId:string;requestId:string|null;requestState:string|null}>,started=Date.now(),paused=process.env.OUTBOUND_DELIVERY_PAUSED==='true'
 for(const item of items){
  if(Date.now()-started>20000)break
  const linked=await batchRpc('prepare_reviewflow_batch_item',{p_batch_id:id,p_item_id:item.itemId})
  if(linked.state==='linked'){
   const child=await db.from('reviewflow_analysis_requests').select('state').eq('id',String(linked.requestId)).eq('property_id',batch.property_id).single();if(child.error)throw new ReviewStoreError('Saved child analysis could not be read.')
   if(child.data.state==='result_ready')await recoverReviewAnalysis(String(linked.requestId),batch.property_id,batch.approved_by)
   else if(child.data.state==='queued'&&linked.ownsRequest===true&&!paused)await runSavedReviewAnalysis(String(linked.requestId))
   // A borrowed request retains its independent execution owner. Uncertain running calls are not invoked again.
  }
  result=await checkpoint();if(!['queued','running'].includes(String(result.state)))break
 }
 return result
}
