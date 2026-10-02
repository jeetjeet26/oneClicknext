import type {SupabaseClient} from '@supabase/supabase-js'
import type {Database,Json} from '@/types/supabase'
import {createServiceClient} from '@/utils/supabase/admin'
import type {IntegrationOAuthStatePayload} from './integration-oauth-state'
type AuthorizationDatabase=Omit<Database,'public'>&{public:Omit<Database['public'],'Functions'>&{Functions:Database['public']['Functions']&{
 begin_integration_authorization:{Args:{p_id:string;p_context:Json};Returns:Json}
 claim_integration_authorization:{Args:{p_id:string;p_context:Json};Returns:Json}
 finish_integration_authorization:{Args:{p_id:string;p_context:Json;p_grant:Json};Returns:Json}
 close_integration_authorization:{Args:{p_id:string;p_context:Json;p_reason:string;p_claim_token:string|null};Returns:Json}
 expire_integration_authorizations:{Args:{p_limit:number};Returns:Json}
}}}
export type AuthorizationResult=Record<string,Json|undefined>
export type AuthorizationFailure='authorization_denied'|'provider_error'|'provider_exchange_failed'|'authorization_unconfirmed'|'permissions_unconfirmed'|'permissions_incomplete'|'invalid_token_response'|'account_unconfirmed'|'authorization_save_unconfirmed'|'invalid_callback'|'expired_state'
const dbClient=()=>createServiceClient() as unknown as SupabaseClient<AuthorizationDatabase>
export const authorizationContext=(s:IntegrationOAuthStatePayload):Json=>({...s.replacementId?{replacementId:s.replacementId}:{},propertyId:s.propertyId,profileId:s.profileId||null,provider:s.provider,capabilities:s.capabilities,authSource:s.authSource,inviteId:s.inviteId||null,tokenHash:s.tokenHash||null,redirectUri:s.redirectUri||null,requestedScopes:s.requestedScopes||[]})
function confirmedResult(data:Json|null,requestId:string):AuthorizationResult {
 if(!data||typeof data!=='object'||Array.isArray(data)||typeof data.state!=='string')throw new Error('authorization_unconfirmed')
 if(['saved','replayed'].includes(data.state)&&(data.requestId!==requestId||typeof data.timezoneSetupRequired!=='boolean'||(!data.calendarId&&!data.emailConfigId)))throw new Error('authorization_unconfirmed')
 return data
}
export async function authorizationOperation(operation:'begin'|'claim'|'finish',state:IntegrationOAuthStatePayload,grant?:Json):Promise<AuthorizationResult>{
 if(!state.requestId||!state.redirectUri)throw new Error('expired_state')
 const db=dbClient(),args={p_id:state.requestId,p_context:authorizationContext(state)}
 // Identical request/save writes are idempotent. A claim is never repeated after uncertainty.
 const attempts=operation==='claim'?1:2
 for(let attempt=0;attempt<attempts;attempt++){
  try{
   const {data,error}=operation==='finish'?await db.rpc('finish_integration_authorization',{...args,p_grant:grant!}):await db.rpc(operation==='begin'?'begin_integration_authorization':'claim_integration_authorization',args)
   if(error)throw new Error('authorization_unconfirmed')
   const result=confirmedResult(data,state.requestId)
   if(result.state==='claimed'&&(typeof result.claimToken!=='string'||!result.claimToken))throw new Error('authorization_unconfirmed')
   if(result.state==='ready'&&result.requestId!==state.requestId)throw new Error('authorization_unconfirmed')
   return result
  }catch{if(attempt===attempts-1)throw new Error('authorization_unconfirmed')}
 }
 throw new Error('authorization_unconfirmed')
}
export async function closeAuthorizationOutcome(state:IntegrationOAuthStatePayload,reason:AuthorizationFailure,claimToken?:string):Promise<AuthorizationResult>{
 if(!state.requestId||!state.redirectUri)throw new Error('authorization_outcome_unconfirmed')
 const db=dbClient(),args={p_id:state.requestId,p_context:authorizationContext(state),p_reason:reason,p_claim_token:claimToken||null}
 for(let attempt=0;attempt<2;attempt++){
  try{
   const {data,error}=await db.rpc('close_integration_authorization',args)
   if(error)throw new Error('authorization_outcome_unconfirmed')
   const result=confirmedResult(data,state.requestId)
   // Replay means a successful save won the race. Conflicts do not claim recorded failure.
   if(result.state==='replayed'||['request_conflict','connection_changed'].includes(String(result.state)))return result
   if(result.requestId!==state.requestId||result.actionEventId!==state.requestId)throw new Error('authorization_outcome_unconfirmed')
   return result
  }catch{if(attempt===1)throw new Error('authorization_outcome_unconfirmed')}
 }
 throw new Error('authorization_outcome_unconfirmed')
}
export type AuthorizationExpiryResult={state:'completed'|'busy';processed:number;skipped:number;remaining:boolean;legacyUnqualified:number}
export async function expireAuthorizationRequests():Promise<AuthorizationExpiryResult>{
 const {data,error}=await dbClient().rpc('expire_integration_authorizations',{p_limit:100})
 if(error||!data||typeof data!=='object'||Array.isArray(data)||!['completed','busy'].includes(String(data.state))||typeof data.remaining!=='boolean'||!['processed','skipped','legacyUnqualified'].every(key=>typeof data[key]==='number'&&Number.isSafeInteger(data[key])&&Number(data[key])>=0)||Number(data.processed)+Number(data.skipped)>100)throw new Error('Authorization cleanup is unconfirmed')
 return data as AuthorizationExpiryResult
}
