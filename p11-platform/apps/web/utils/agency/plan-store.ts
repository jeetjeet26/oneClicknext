import {createServiceClient} from '@/utils/supabase/admin'
import {InventoryError,inventoryActor} from '@/utils/knowledge/inventory'
import {planBoard,planReceipt,type PlanCommand} from './plans'
export {InventoryError as AgencyError,inventoryActor as agencyActor}
const messages:Record<string,string> = {
 forbidden:'Agency plans are unavailable for your current property or role.',
 request_conflict:'This request belongs to a different saved decision. Check the saved plan.',
 evidence_changed:'The evidence changed. Refresh before reviewing it.',
 revision_changed:'A newer plan revision exists. Refresh before saving your changes.',
 draft_required:'Save changed content as a draft before recording its review or withdrawal.',
 decision_cancelled:'This unused request was closed. Start a new draft.',
 not_found:'This plan request has not been found. Keep the request open or close it before starting another.',
 invalid:'Review the property, evidence and decision before saving.'
}
async function rpc(name:string,args:Record<string,unknown>,kind:'board'|'history'|'decision') {
 const db=createServiceClient() as unknown as {rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}
 const {data,error}=await db.rpc(name,args)
 if(error||!data)throw new InventoryError('The agency plan could not be confirmed. Check the saved request before trying again.')
 if(!['ready','saved','replayed'].includes(String(data.state)))throw new InventoryError(messages[String(data.state)]||'The agency plan result could not be verified.',data.state==='forbidden'?403:data.state==='not_found'?404:409)
 const parsed=(kind==='decision'?planReceipt:planBoard).safeParse(data)
 if(!parsed.success||parsed.data.propertyId!==args.p_property_id)throw new InventoryError('The agency plan receipt could not be verified.')
 if(parsed.data.product!==(args.p_input as Record<string,unknown>).product)throw new InventoryError('The plan does not match this product.');
 if(kind==='decision'){
  const receipt=planReceipt.parse(data)
  const expected=args.p_id||(args.p_input as Record<string,unknown>).decisionId
  if(receipt.decisionId!==expected||receipt.record.id!==expected||receipt.record.property_id!==args.p_property_id||receipt.record.actor_id!==args.p_actor_id||receipt.record.product!==receipt.product)throw new InventoryError('The saved plan does not match this request.')
 }
 if(kind!=='decision'){const board=planBoard.parse(data);if(board.items.some(r=>r.property_id!==board.propertyId||r.product!==board.product)||(board.current&&(board.current.property_id!==board.propertyId||board.current.product!==board.product))||(board.evidence&&(board.evidence.propertyId!==board.propertyId||board.evidence.product!==board.product)))throw new InventoryError('The plan evidence does not match this property.')}
 return parsed.data
}
export function readPlan(actor:string,propertyId:string,input:Record<string,unknown>){return rpc('read_agency_plan',{p_property_id:propertyId,p_actor_id:actor,p_input:input},input.kind==='history'?'history':input.kind==='decision'?'decision':'board')}
export function savePlan(actor:string,command:PlanCommand){const {propertyId,requestId,...input}=command;return rpc('save_agency_plan',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:input},'decision')}
