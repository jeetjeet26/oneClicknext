import {createServiceClient} from '@/utils/supabase/admin'
import {InventoryError,inventoryActor} from './inventory'
import {prepareKnowledgeText,executeKnowledgeSearch,type KnowledgeModelInput,type KnowledgeReceipt} from './material-model'
import type {MaterialCommand,MaterialDetail} from './material-contracts'
export {inventoryActor as materialActor,InventoryError as MaterialError}
type Value=Record<string,unknown>
const messages:Record<string,string>={decision_cancelled:'This unused request was cancelled. Start a new reviewed decision.',forbidden:'This source is unavailable in your current property.',not_found:'This saved source or decision is unavailable.',request_conflict:'This request differs from its retained decision. Inspect saved history.',source_changed:'The source changed. Reload and review its current version.',request_changed:'Search preparation changed. Reload its saved status.',history_changed:'Knowledge history changed. Reload before continuing.',existing_search:'This version already has a saved preparation. Open its status; do not start another.',closed_request:'This preparation is already closed.',still_running:'Preparation is still awaiting its result. Reload after 90 seconds.',preparation_required:'This version needs valid retained search data before publication.',already_published:'This version is already published.',receipt_changed:'The retained receipt changed. Reload its saved status.'}
export async function knowledgeRpc(name:string,args:Value){const db=createServiceClient()as unknown as{rpc:(name:string,args:Value)=>Promise<{data:Value|null;error:unknown}>};const{data,error}=await db.rpc(name,args);if(error||!data)throw new InventoryError('This knowledge operation could not be confirmed. Check its saved decision before retrying.');if(!['cancelled','ready','saved','replayed','queued','running','result_ready','held','stopped','invoke_once'].includes(String(data.state)))throw new InventoryError(messages[String(data.state)]||'Review the saved source before continuing.',data.state==='forbidden'?403:data.state==='not_found'?404:409);return data}
export function readMaterials(actor:string,propertyId:string,input:Value={}){return knowledgeRpc('read_knowledge_materials',{p_property_id:propertyId,p_actor_id:actor,p_input:input})}
export function knowledgeExecutionStatus(){return{paused:process.env.OUTBOUND_DELIVERY_PAUSED==='true',configured:!!process.env.OPENAI_API_KEY}}
async function retainedSearch(id:string){const{data,error}=await createServiceClient().from('knowledge_embedding_requests').select('id,state,result_hash').eq('id',id).maybeSingle();if(error||!data)throw new InventoryError('Saved search status could not be read.');return data}
export async function validateRetainedSearch(id:string){const run=await retainedSearch(id);return run.state==='result_ready'?knowledgeRpc('validate_knowledge_search',{p_id:id,p_result_hash:run.result_hash}):{state:run.state}}
export async function runKnowledgeSearch(id:string){
 const status=knowledgeExecutionStatus();if(status.paused)return{state:'paused'};if(!status.configured)return{state:'provider_unavailable'}
 const claim=await knowledgeRpc('claim_knowledge_search',{p_id:id});if(claim.state==='result_ready')return validateRetainedSearch(id);if(claim.state!=='invoke_once')return claim
 let receipt:KnowledgeReceipt;try{receipt=await executeKnowledgeSearch(claim.modelInput as KnowledgeModelInput)}catch{receipt={status:'uncertain',errorCode:'model_uncertain'}}
 const args={p_id:id,p_claim_token:claim.claimToken,p_result:receipt};let result:Value
 try{result=await knowledgeRpc('record_knowledge_search_result',args)}catch{result=await knowledgeRpc('record_knowledge_search_result',args)}
 return result.requestState==='result_ready'?validateRetainedSearch(id):result
}
export async function recoverKnowledgeSearch(id:string){const run=await retainedSearch(id);return run.state==='result_ready'?validateRetainedSearch(id):run.state==='queued'?runKnowledgeSearch(id):{state:run.state}}
export async function decideMaterial(actor:string,command:MaterialCommand){
 const{requestId,propertyId,operation,...input}=command,args={p_id:requestId,p_property_id:propertyId,p_actor_id:actor}
 if(operation==='cancel_unused')return knowledgeRpc('cancel_unused_knowledge_decision',{...args,p_input:input})
 if(operation==='save')return knowledgeRpc('save_knowledge_material',{...args,p_input:input})
 if(operation==='prepare'){
  const exact=command as Extract<MaterialCommand,{operation:'prepare'}>
  // Check the prior decision first: replay must remain possible after a later source revision.
  let replay=false;try{await readMaterials(actor,propertyId,{kind:'decision',materialId:exact.materialId,decisionId:requestId});replay=true}catch(e){if(!(e instanceof InventoryError)||e.status!==404)throw e}
  let model:KnowledgeModelInput|Record<string,never>={}
  if(!replay){const current=await readMaterials(actor,propertyId,{kind:'version',materialId:exact.materialId,versionId:exact.versionId})as unknown as MaterialDetail;model=prepareKnowledgeText(current.version.content)}
  const result=await knowledgeRpc('begin_knowledge_search',{...args,p_input:input,p_model_input:model})
  return {...result,execution:await recoverKnowledgeSearch(String(result.searchId))}
 }
 if(operation==='stop'||operation==='recover'){
  const result=await knowledgeRpc('control_knowledge_search',{...args,p_input:{...input,operation}})
  return operation==='recover'?{...result,execution:await recoverKnowledgeSearch(String(result.searchId))}:result
 }
 return knowledgeRpc('release_knowledge_material',{...args,p_input:{...input,operation}})
}
