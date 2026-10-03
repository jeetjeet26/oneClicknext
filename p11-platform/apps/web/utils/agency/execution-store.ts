import {createServiceClient} from '@/utils/supabase/admin'
import {InventoryError,inventoryActor} from '@/utils/knowledge/inventory'
import {executionBoard,executionReceipt,executionRun,type ExecutionCommand} from './execution'
export {InventoryError as AgencyError,inventoryActor as agencyActor}
const messages:Record<string,string>={forbidden:'Execution history is unavailable for your current property or role.',execution_disabled:'Execution is not launched for this property.',evidence_changed:'The reviewed evidence changed. Refresh and review the plan again.',scope_expired:'The local rehearsal permission expired.',plan_changed:'The reviewed plan changed. Prepare a new proposal.',source_changed:'The target changed. Review its current state.',target_denied:'This target is outside the permitted local rehearsal.',run_changed:'The run changed. Check its current receipt.',state_changed:'This action is unavailable in the current run state.',request_conflict:'This request belongs to another command.',decision_cancelled:'This unused command was closed.',not_found:'This command has not been found. Keep its identity when checking again.',invalid:'Review the exact targets, limits and command.'}
async function rpc(name:string,args:Record<string,unknown>,kind:string){
 const db=createServiceClient()as unknown as{rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}
 const{data,error}=await db.rpc(name,args)
 if(error||!data)throw new InventoryError('The execution receipt could not be confirmed. Keep the same request identity when checking again.')
 if(!['ready','saved','replayed'].includes(String(data.state)))throw new InventoryError(messages[String(data.state)]||'The execution result could not be verified.',data.state==='forbidden'?403:data.state==='not_found'?404:409)
 const parsed=(kind==='decision'?executionReceipt:kind==='run'?executionRun:executionBoard).safeParse(data)
 if(!parsed.success||parsed.data.propertyId!==args.p_property_id)throw new InventoryError('The execution response does not match this property.')
 const input=args.p_input as Record<string,unknown>
 if(kind==='decision'){
  const d=executionReceipt.parse(data),expected=args.p_id||input.decisionId
  if(d.decisionId!==expected||d.record.id!==expected||d.record.property_id!==args.p_property_id||d.record.actor_id!==args.p_actor_id||d.record.result.runId!==d.record.run_id)throw new InventoryError('The execution receipt does not match this request.')
 }
 if(kind==='run'){
  const d=executionRun.parse(data)
  if(d.run.id!==input.runId||d.run.property_id!==args.p_property_id||d.steps.some(s=>s.run_id!==d.run.id))throw new InventoryError('The execution steps do not match this run.')
 }
 return parsed.data
}
export function readExecution(actor:string,propertyId:string,input:Record<string,unknown>){return rpc('read_agency_execution',{p_property_id:propertyId,p_actor_id:actor,p_input:input},String(input.kind||'board'))}
export function operateExecution(actor:string,command:ExecutionCommand){const{propertyId,requestId,...input}=command;return rpc('operate_agency_execution',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:input},'decision')}
