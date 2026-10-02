import {createServiceClient} from '@/utils/supabase/admin'
import {MarketStoreError} from './decision-store'
import {buildSavedBrief,type SavedMarketBrief} from './saved-brief'
export interface SavedBriefRecord {id:string;version:number;state:'prepared'|'ready';input:{windowDays:number;reason:string};source_snapshot:unknown;source_hash:string;result:SavedMarketBrief|null;created_at:string}
export async function briefRpc(name:string,args:Record<string,unknown>,allowed=['ready','prepared','saved','replayed']){
 const db=createServiceClient() as unknown as {rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}
 const {data,error}=await db.rpc(name,args)
 if(error||!data)throw new MarketStoreError('The report decision could not be confirmed. Retry the same request or reload its saved history.')
 const messages:Record<string,string>={forbidden:'This report is unavailable to your account.',not_found:'This report is unavailable in the selected property.',stale_review:'Another operator changed this recommendation review. Reload its latest decision.',stale_report:'Reload the exact saved report before making this decision.',request_conflict:'This decision differs from the saved request. Reload its history.',source_changed:'Source evidence changed. Review a new brief before forwarding this recommendation.',snapshot_too_large:'The complete evidence snapshot is too large. No partial report was saved.',cursor_changed:'Reload report history before loading more.'}
 if(!allowed.includes(String(data.state)))throw new MarketStoreError(messages[String(data.state)]??'Review the current saved report.',data.state==='forbidden'?403:data.state==='not_found'?404:data.state==='snapshot_too_large'?503:409)
 return data
}
export async function readSavedBrief(propertyId:string,actorId:string,requestId?:string,cursor?:string){return briefRpc('read_marketvision_briefs',{p_property_id:propertyId,p_actor_id:actorId,p_request_id:requestId??null,p_cursor:cursor??null})}
export async function completeSavedBrief(propertyId:string,actorId:string,requestId:string){
 const detail=await readSavedBrief(propertyId,actorId,requestId),r=detail.report as unknown as SavedBriefRecord
 if(r.state==='ready')return {state:'ready',requestId:r.id,version:r.version}
 let result:SavedMarketBrief
 try{result=buildSavedBrief(r.id,r.source_hash,r.source_snapshot)}catch{throw new MarketStoreError('The retained report evidence needs repair. Its original source snapshot is preserved.')}
 return briefRpc('complete_marketvision_brief',{p_id:r.id,p_property_id:propertyId,p_actor_id:actorId,p_source_hash:r.source_hash,p_result:result})
}
