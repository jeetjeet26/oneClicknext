import {createServiceClient} from '@/utils/supabase/admin'
import {MarketStoreError} from './decision-store'
import {MonitoringPage,MonitoringDetail} from './monitoring-contract'
export async function readMarketMonitoring(input:{propertyId:string;actorId:string;filter:string;requestId?:string;cursor?:string}){
 const db=createServiceClient()as unknown as{rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}
 const {data,error}=await db.rpc('read_marketvision_monitoring',{p_property_id:input.propertyId,p_actor_id:input.actorId,p_filter:input.filter,p_request_id:input.requestId??null,p_cursor:input.cursor??null})
 if(error||!data)throw new MarketStoreError('Saved monitoring evidence could not be loaded. Reload to retry.')
 if(data.state==='forbidden')throw new MarketStoreError('This property is unavailable.',403)
 if(data.state==='not_found')throw new MarketStoreError('This saved work is unavailable in the selected property.',404)
 if(data.state==='cursor_changed')throw new MarketStoreError('The saved-work view changed. Reload before loading more.',409)
 const parsed=(input.requestId?MonitoringDetail:MonitoringPage).safeParse(data)
 if(!parsed.success)throw new MarketStoreError('The complete monitoring evidence could not be confirmed. Reload to retry.')
 return parsed.data
}
