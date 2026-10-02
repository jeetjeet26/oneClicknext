import type {SupabaseClient} from '@supabase/supabase-js'
import type {Database,Json} from '@/types/supabase'
import {createServiceClient} from '@/utils/supabase/admin'
export type ReplacementReview={state:'review';capability:'calendar'|'email';revision:string;connections:{id:string;provider:string;accountEmail:string;enabled:boolean}[];historyCount:number;activeCount:number;workCount:number;blockers:string[]}
type ReplacementDatabase=Omit<Database,'public'>&{public:Omit<Database['public'],'Functions'>&{Functions:Database['public']['Functions']&{
 integration_replacement_review:{Args:{p_property_id:string;p_actor_id:string;p_capability:string};Returns:Json}
 request_recorded_integration_replacement:{Args:{p_property_id:string;p_actor_id:string;p_request_id:string;p_capability:string;p_provider:string;p_account_email:string;p_revision:string};Returns:Json}
}}}
const database=()=>createServiceClient() as unknown as SupabaseClient<ReplacementDatabase>
export async function readReplacementReview(propertyId:string,actorId:string,capability:string):Promise<ReplacementReview>{
 const {data,error}=await database().rpc('integration_replacement_review',{p_property_id:propertyId,p_actor_id:actorId,p_capability:capability})
 if(error||!data||typeof data!=='object'||Array.isArray(data)||data.state!=='review'||typeof data.revision!=='string'||!Array.isArray(data.connections)||!Array.isArray(data.blockers))throw new Error('Replacement review is unavailable. Retry to load the current account and linked work.')
 return data as unknown as ReplacementReview
}
export async function requestReplacement(input:{propertyId:string;actorId:string;requestId:string;capability:string;provider:string;accountEmail:string;revision:string}):Promise<Record<string,Json|undefined>>{
 for(let attempt=0;attempt<2;attempt++){
  try{
   const {data,error}=await database().rpc('request_recorded_integration_replacement',{p_property_id:input.propertyId,p_actor_id:input.actorId,p_request_id:input.requestId,p_capability:input.capability,p_provider:input.provider,p_account_email:input.accountEmail,p_revision:input.revision})
   if(error||!data||typeof data!=='object'||Array.isArray(data)||typeof data.state!=='string')throw new Error('unconfirmed')
   if(['ready','replayed'].includes(data.state)&&(data.actionEventId!==input.requestId||data.replacementId!==input.requestId||typeof data.expiresAt!=='string'||!Number.isFinite(Date.parse(data.expiresAt))||Date.parse(data.expiresAt)<=Date.now()))throw new Error('unconfirmed')
   return data
  }catch{if(attempt===1)throw new Error('The replacement decision could not be confirmed. Retry the same request.')}
 }
 throw new Error('Replacement unconfirmed')
}
export const replacementMessages:Record<string,string>={stale_review:'The account or linked work changed. Reload the review before continuing.',linked_work_requires_review:'Finish the linked work shown in the review before changing accounts.',use_reconnect:'Use Reconnect to renew access to the same account.',replacement_unavailable:'This replacement request expired or was already started. Reload the review to start again.',request_conflict:'This request was already used for a different decision. Reload the review.'}
