import {createServiceClient} from '@/utils/supabase/admin'
import {MarketStoreError} from './decision-store'
import {AlertPage} from './alert-contracts'
export async function alertRpc(name:string,args:Record<string,unknown>){
 const db=createServiceClient()as unknown as{rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}
 const {data,error}=await db.rpc(name,args)
 if(error||!data)throw new MarketStoreError('The alert decision could not be confirmed. Retry the same decision or reload saved alerts.')
 const messages:Record<string,string>={forbidden:'This property is unavailable.',not_found:'One of these alerts is unavailable in the selected property.',stale_alert:'An alert changed after it was displayed. Reload and review the current selection.',alert_state_changed:'This alert already has a different review state. Reload its saved status.',request_conflict:'This request differs from its saved decision. Reload the saved history.',cursor_changed:'Reload alerts before loading more.'}
 if(!['ready','saved','replayed'].includes(String(data.state)))throw new MarketStoreError(messages[String(data.state)]??'Review the current saved alerts.',data.state==='forbidden'?403:data.state==='not_found'?404:409)
 return data
}
export async function readMarketAlerts(args:Record<string,unknown>){const data=await alertRpc('read_marketvision_alerts',args),parsed=AlertPage.safeParse(data);if(!parsed.success)throw new MarketStoreError('The complete alert list and counts could not be confirmed. Reload to retry.');return parsed.data}
