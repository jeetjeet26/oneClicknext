import {createServiceClient} from '@/utils/supabase/admin'
import {InventoryError,inventoryActor} from '@/utils/knowledge/inventory'
import {evaluateReadinessSources,type ReadinessSources} from './evaluator'
import type {ReadinessCommand} from './contracts'
export {InventoryError as ReadinessError,inventoryActor as readinessActor}
const messages:Record<string,string>={forbidden:'Readiness review is unavailable with your current property access.',scope_changed:'This readiness evidence belongs to an earlier organization. Ownership needs review.',not_found:'The selected readiness check or decision is unavailable.',sources_changed:'Source facts changed. Build and review a new readiness check.',snapshot_changed:'The saved readiness check changed. Reload before reviewing it.',snapshot_conflict:'Earlier readiness evidence needs a fresh supported review.',not_approvable:'Resolve required readiness items before approving this check.',override_required:'Confirm the listed warnings and explain the manager decision in at least ten characters.',history_changed:'Readiness history changed. Reload before continuing.',request_conflict:'This request differs from its saved readiness decision.',decision_cancelled:'This unused readiness decision was cancelled.',sources_too_large:'The complete source evidence exceeds the supported review size. No partial check was saved.'}
type Client={rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}
export async function readinessRpc(name:string,args:Record<string,unknown>,client:unknown=createServiceClient()){
 const db=client as Client,{data,error}=await db.rpc(name,args)
 if(error||!data)throw new InventoryError('The readiness decision could not be confirmed. Check its saved result before retrying.')
 if(!['ready','saved','replayed','cancelled'].includes(String(data.state)))throw new InventoryError(messages[String(data.state)]||'Readiness evidence could not be verified.',['forbidden','scope_changed'].includes(String(data.state))?403:data.state==='not_found'?404:409)
 if(data.propertyId!==args.p_property_id)throw new InventoryError('The readiness receipt does not match this property.')
 return data
}
export function readReadiness(actor:string,propertyId:string,input:Record<string,unknown>,client?:unknown){return readinessRpc('read_readiness_reviews',{p_property_id:propertyId,p_actor_id:actor,p_input:input},client)}
export async function decideReadiness(actor:string,command:ReadinessCommand,client:unknown=createServiceClient()){
 const {requestId,propertyId,...input}=command
 let calculation:Record<string,unknown>|null=null
 if(command.operation==='build'){
  // A successful earlier request is recovered before reading newer facts.
  try{await readReadiness(actor,propertyId,{kind:'decision',decisionId:requestId},client);return await readinessRpc('decide_readiness_review',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:input},client)}catch(e){if(!(e instanceof InventoryError)||e.status!==404)throw e}
  const bundle=await readReadiness(actor,propertyId,{kind:'sources'},client)
  if(bundle.canManage!==true)throw new InventoryError('A property manager can build readiness checks.',403)
  calculation={sourceHash:bundle.sourceHash,...evaluateReadinessSources(bundle.sources as ReadinessSources,command.enabledCapabilities,String(bundle.sourceHash))}
 }
 return readinessRpc('decide_readiness_review',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:input,...(calculation?{p_calculation:calculation}:{})},client)
}
