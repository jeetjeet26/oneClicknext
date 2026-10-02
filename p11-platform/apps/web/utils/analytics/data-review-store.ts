import {createServiceClient} from '@/utils/supabase/admin'
import {InventoryError} from '@/utils/knowledge/inventory'
export {biActor as dataReviewActor} from './report-store'
export {InventoryError}
const messages:Record<string,string>={forbidden:'Your current account cannot make this data decision.',not_found:'The saved data review is unavailable in this property.',source_changed:'The data or history changed. Refresh and save a new review before continuing.',import_running:'An import is running. Wait for it to finish, then refresh this review.',overlap_requires_review:'Newer data overlaps this row. Review and exclude the replacement before restoring the older row.',review_required:'This decision is already recorded. Check its saved history.',invalid_input:'Review the exact data, dates and decision fields.',request_conflict:'This request differs from its saved result. Check the original request.'}
export async function dataReviewRpc(name:string,args:Record<string,unknown>){
 const client=createServiceClient();const{data,error}=await(client as unknown as{rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:{code?:string;message:string}|null}>}).rpc(name,args)
 if(error||!data)throw new InventoryError(error?.code==='22023'?error.message:'The data decision could not be confirmed. Check its saved request.',error?.code==='22023'?400:503)
 if(!['ready','saved'].includes(String(data.state)))throw new InventoryError(messages[String(data.state)]||'The data review is unavailable.',data.state==='forbidden'?403:data.state==='not_found'?404:409)
 if(data.propertyId!==args.p_property_id||(args.p_id&&data.id!==args.p_id)||(args.p_command_id&&data.id!==args.p_command_id))throw new InventoryError('The result does not match the current property or request.')
 return data
}
