import {createServiceClient} from '@/utils/supabase/admin'
import {InventoryError} from '@/utils/knowledge/inventory'
export {biActor as csvActor} from './report-store'
export {InventoryError}
const messages:Record<string,string>={excluded_review_required:'This exact account row is excluded. Review and restore it before preparing a replacement import.',forbidden:'Your account cannot make this import decision in the current property.',not_found:'This saved import is unavailable in the current property.',source_changed:'The destination data changed. Prepare a new preview from the saved original before importing.',history_changed:'Import history changed. Refresh before continuing.',legacy_review_required:'Earlier rows have unconfirmed account or currency details. Reconcile those rows before applying this import.',import_running:'An account import is running. Wait for it to finish, then review this preview again.',review_required:'This import already has a saved decision. Inspect its history.',invalid_input:'Review the import fields and exact source.',invalid_parent:'Choose a retained preview or discarded import from this property.',request_conflict:'This request differs from its saved result. Check the original request before continuing.'}
export async function csvRpc(name:string,args:Record<string,unknown>){
 const client=createServiceClient();const{data,error}=await(client as unknown as{rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}).rpc(name,args)
 if(error||!data)throw new InventoryError('The import result could not be confirmed. Check the saved request before retrying.')
 if(!['ready','saved','replayed'].includes(String(data.state)))throw new InventoryError(messages[String(data.state)]||'The import result is unavailable.',data.state==='forbidden'?403:data.state==='not_found'?404:409)
 if(data.propertyId!==args.p_property_id||(args.p_id&&data.id!==args.p_id)||(args.p_command_id&&data.id!==args.p_command_id))throw new InventoryError('The result does not match the current property or import.')
 return data
}
