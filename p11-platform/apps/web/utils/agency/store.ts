import {createServiceClient} from '@/utils/supabase/admin'
import {InventoryError,inventoryActor} from '@/utils/knowledge/inventory'
import {boardSchema,historySchema,receiptSchema,type AgencyCommand} from './contracts'
export {InventoryError as AgencyError,inventoryActor as agencyActor}
const messages:Record<string,string> = {
 forbidden:'Agency review is unavailable for your current property or role.',
 request_conflict:'This request belongs to a different saved decision. Check the saved review.',
 evidence_changed:'The evidence changed. Refresh before reviewing it.',
 no_recommendation:'There is no recorded failure or unfinished work to review for this product.',
 decision_cancelled:'This unused request was closed. Start a new review.',
 not_found:'This review has not been found. Keep the request open or close it before starting another.',
 invalid:'Review the property, evidence and decision before saving.'
}
async function rpc(name:string,args:Record<string,unknown>,kind:'board'|'history'|'decision') {
 const db=createServiceClient() as unknown as {rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}
 const {data,error}=await db.rpc(name,args)
 if(error||!data)throw new InventoryError('The agency review could not be confirmed. Check the saved request before trying again.')
 if(!['ready','saved','replayed'].includes(String(data.state)))throw new InventoryError(messages[String(data.state)]||'The agency review result could not be verified.',data.state==='forbidden'?403:data.state==='not_found'?404:409)
 const parsed=(kind==='board'?boardSchema:kind==='history'?historySchema:receiptSchema).safeParse(data)
 if(!parsed.success||parsed.data.propertyId!==args.p_property_id)throw new InventoryError('The agency review receipt could not be verified.')
 if(kind==='decision'){
  const receipt=receiptSchema.parse(data)
  const expected=args.p_id||(args.p_input as Record<string,unknown>).decisionId
  if(receipt.decisionId!==expected||receipt.record.id!==expected||receipt.record.property_id!==args.p_property_id||receipt.record.actor_id!==args.p_actor_id)throw new InventoryError('The saved review does not match this request.')
 }
 return parsed.data
}
export function readAgency(actor:string,propertyId:string,input:Record<string,unknown>){return rpc('read_agency_observation',{p_property_id:propertyId,p_actor_id:actor,p_input:input},input.kind==='history'?'history':input.kind==='decision'?'decision':'board')}
export function decideAgency(actor:string,command:AgencyCommand){const {propertyId,requestId,...input}=command;return rpc('decide_agency_observation',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:input},'decision')}
