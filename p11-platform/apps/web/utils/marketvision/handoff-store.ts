import {createServiceClient} from '@/utils/supabase/admin'
import {MarketStoreError} from './decision-store'
export async function handoffRpc(name:string,args:Record<string,unknown>){
 const db=createServiceClient()as unknown as{rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}
 const {data,error}=await db.rpc(name,args)
 if(error||!data)throw new MarketStoreError('The handoff could not be confirmed. Retry the same decision or reload its saved history.')
 const messages:Record<string,string>={forbidden:'This property is unavailable to your account.',not_found:'This handoff is unavailable in the selected property.',manager_required:'A current property manager must approve or reject this draft.',stale_handoff:'This handoff changed. Reload its saved decision.',stale_report:'Reload the saved report before preparing a handoff.',stale_review:'The recommendation review changed. Review it again before preparing a handoff.',source_changed:'Source evidence changed or is unavailable. Create and review a current brief before preparing a new handoff.',requester_unavailable:'The original requester no longer has access. Prepare a new handoff with a current operator.',handoff_exists:'This reviewed recommendation already has a handoff. Reload its history to open it.',source_review_required:'Verify source coverage before preparing a marketing draft.',invalid_format:'Choose a supported format for this channel.',request_conflict:'This request differs from its saved decision. Reload the handoff history.',cursor_changed:'Reload handoff history before loading more.'}
 if(!['ready','saved','replayed'].includes(String(data.state)))throw new MarketStoreError(messages[String(data.state)]??'Review the current saved handoff.',['forbidden','manager_required'].includes(String(data.state))?403:data.state==='not_found'?404:409)
 return data
}
