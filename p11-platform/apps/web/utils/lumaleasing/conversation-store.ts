import {createServiceClient} from '@/utils/supabase/admin'
import {InventoryError} from '@/utils/knowledge/inventory'
export {biActor as conversationActor} from '@/utils/analytics/report-store'
export {InventoryError}
const messages:Record<string,string>={forbidden:'Only a current property manager or administrator can change this conversation.',not_found:'This conversation or saved decision is unavailable in this property.',source_changed:'The conversation changed. Refresh its messages before deciding.',mode_changed:'The conversation mode changed. Refresh before replying or changing control.',request_conflict:'This request differs from its saved decision. Check the saved request.',invalid_input:'Review the conversation decision and selected source.'}
export async function conversationRpc(name:string,args:Record<string,unknown>){
 const client=createServiceClient();const{data,error}=await(client as unknown as{rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}).rpc(name,args)
 if(error||!data)throw new InventoryError('The conversation result could not be confirmed. Check its saved request.')
 if(!['ready','saved'].includes(String(data.state)))throw new InventoryError(messages[String(data.state)]||'The conversation decision is unavailable.',data.state==='forbidden'?403:data.state==='not_found'?404:409)
 if(data.propertyId!==args.p_property_id||(args.p_id&&data.id!==args.p_id))throw new InventoryError('The saved result does not match this property or request.')
 return data
}
