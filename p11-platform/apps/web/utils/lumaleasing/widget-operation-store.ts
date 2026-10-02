import {createServiceClient} from '@/utils/supabase/admin'
import {InventoryError} from '@/utils/knowledge/inventory'
export {biActor as widgetActor} from '@/utils/analytics/report-store'
export {InventoryError}
const messages:Record<string,string>={forbidden:'Only a current property manager or administrator can change these widget controls.',not_found:'Your saved widget request is unavailable in this property.',not_configured:'Initialize the widget configuration first.',source_changed:'The saved widget or key changed. Refresh before making another decision.',history_changed:'Widget history changed. Refresh before continuing.',asset_changed:'This image changed or is not approved for this property. Review its current library record.',request_conflict:'This request differs from its saved decision. Check the original request.',review_required:'This outcome already has a saved decision. Inspect its history.',invalid_input:'Review the widget decision and selected source.'}
export async function widgetRpc(name:string,args:Record<string,unknown>){
 const client=createServiceClient();const{data,error}=await(client as unknown as{rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}).rpc(name,args)
 if(error||!data)throw new InventoryError('The widget result could not be confirmed. Check its saved request.')
 if(!['ready','saved'].includes(String(data.state)))throw new InventoryError(messages[String(data.state)]||'The saved widget decision is unavailable.',data.state==='forbidden'?403:data.state==='not_found'?404:409)
 if(data.propertyId!==args.p_property_id||(args.p_id&&data.id!==args.p_id)||(args.p_command_id&&data.id!==args.p_command_id))throw new InventoryError('The result does not match this property or request.')
 return data
}
