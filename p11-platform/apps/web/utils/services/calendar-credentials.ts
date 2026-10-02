import {refreshedScopeEvidence} from './integration-permissions'
import {randomUUID} from 'node:crypto'
import type {Database,Json} from '@/types/supabase'
import type {SupabaseClient} from '@supabase/supabase-js'
import {createServiceClient} from '@/utils/supabase/admin'
import {getMicrosoftTokenUrl,getProviderClientId,getProviderClientSecret,GOOGLE_TOKEN_URL} from './integration-provider-config'

export type CalendarCredentials={id:string;property_id:string;provider?:'google'|'microsoft';account_email?:string;google_email:string;calendar_id:string;provider_subject?:string|null;tenant_id?:string|null;credential_version?:number;access_token:string;refresh_token:string;token_expires_at:string;token_status:string}
type CredentialDatabase=Omit<Database,'public'> & {public:Omit<Database['public'],'Functions'> & {Functions:Database['public']['Functions'] & {
 claim_calendar_token_refresh:{Args:{p_property_id:string;p_calendar_id:string;p_version:number;p_identity:Json;p_request_id:string;p_force:boolean};Returns:Json}
 finish_calendar_token_refresh:{Args:{p_property_id:string;p_calendar_id:string;p_request_id:string;p_outcome:string;p_tokens?:Json};Returns:Json}
}}}
const credentialDb=(db:SupabaseClient<Database>)=>db as unknown as SupabaseClient<CredentialDatabase>
type Result={state:string;accessToken?:string;refreshToken?:string;expiresAt?:string;version?:number;permissionState?:string}
const messages:Record<string,string>={permissions_unconfirmed:'The saved permissions could not be confirmed. Reconnect this account.',permissions_incomplete:'This account is missing required permissions. Reconnect and grant the requested access.',busy:'Calendar access is being renewed. Try again shortly.',retry_later:'The calendar provider is unavailable. Try again shortly.',connection_changed:'The calendar connection changed. Reload before trying again.',reconnect_required:'Reconnect the calendar to restore access.',refresh_unconfirmed:'Calendar access renewal could not be confirmed. Reconnect the calendar.',revoked:'Calendar authorization expired or was revoked. Reconnect the calendar.',review:'Calendar access renewal could not be confirmed. Reconnect the calendar.',failed:'The calendar provider is unavailable. Try again shortly.'}
function result(data:unknown):Result{
 if(!data||typeof data!=='object'||!('state' in data)||typeof data.state!=='string')throw new Error('Calendar access renewal could not be confirmed.')
 return data as Result
}
function acceptSavedCredentials(config:CalendarCredentials,data:Result){
 if(!['ready','saved'].includes(data.state))throw new Error(messages[data.state]||'Calendar connection could not be verified.')
 if(data.permissionState!=='confirmed'||!data.accessToken||!data.refreshToken||!data.expiresAt||!Number.isSafeInteger(data.version)||!Number.isFinite(Date.parse(data.expiresAt))||Date.parse(data.expiresAt)<=Date.now())throw new Error('Saved calendar credentials could not be confirmed.')
 // Keep repeated operations on this request's config aligned with the saved revision.
 Object.assign(config,{access_token:data.accessToken,refresh_token:data.refreshToken,token_expires_at:data.expiresAt,credential_version:data.version,token_status:'healthy'})
 return {accessToken:data.accessToken,expiresAt:data.expiresAt}
}
export async function renewCalendarCredentials(config:CalendarCredentials,force=false,db=createServiceClient()):Promise<{accessToken:string;expiresAt:string}>{
 if(!Number.isSafeInteger(config.credential_version)||Number(config.credential_version)<1)throw new Error('Reload the calendar connection before renewing access.')
 const provider=config.provider||'google',clientId=getProviderClientId(provider),clientSecret=getProviderClientSecret(provider)
 const rpc=credentialDb(db),requestId=randomUUID(),args={p_property_id:config.property_id,p_calendar_id:config.id,p_request_id:requestId}
 const claim=await rpc.rpc('claim_calendar_token_refresh',{...args,p_version:config.credential_version!,p_identity:{provider,accountEmail:config.account_email||config.google_email,calendarId:config.calendar_id||'primary',subject:config.provider_subject||null,tenant:config.tenant_id||null},p_force:force})
 if(claim.error)throw new Error('Calendar access renewal could not be started.')
 const claimed=result(claim.data)
 if(claimed.state!=='claimed')return acceptSavedCredentials(config,claimed)
 if(!claimed.refreshToken)throw new Error('Calendar refresh credentials could not be confirmed.')
 async function finish(outcome:string,tokens:Json|null=null){
  const parameters={...args,p_outcome:outcome,...(tokens?{p_tokens:tokens}:{})}
  // Retry only the idempotent database finalization, never the OAuth exchange.
  for(let attempt=0;attempt<2;attempt++){
   try{const saved=await rpc.rpc('finish_calendar_token_refresh',parameters);if(saved.error)throw saved.error;return result(saved.data)}
   catch{if(attempt===1)throw new Error('Calendar access renewal could not be saved. Reconnect if it remains unavailable.')}
  }
  throw new Error('Calendar access renewal could not be saved.')
 }
 if(!clientId||!clientSecret){await finish('temporary_failure');throw new Error('Calendar authorization is not configured.')}
 let response:Response
 try{
  response=await fetch(provider==='microsoft'?getMicrosoftTokenUrl():GOOGLE_TOKEN_URL,{method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:claimed.refreshToken,grant_type:'refresh_token'})})
 }catch{return acceptSavedCredentials(config,await finish('unconfirmed'))}
 const payload=await response.json().catch(()=>null) as Record<string,unknown>|null
 if(!response.ok)return acceptSavedCredentials(config,await finish(payload?.error==='invalid_grant'?'revoked':'temporary_failure'))
 const access=payload?.access_token,refresh=payload?.refresh_token,expires=payload?.expires_in
 if(typeof access!=='string'||/\s/.test(access)||!access.trim()||access.length>16384||typeof expires!=='number'||!Number.isFinite(expires)||expires<=0||expires>366*86400||
  (refresh!==undefined&&(typeof refresh!=='string'||/\s/.test(refresh)||!refresh.trim()||refresh.length>16384))||
  (payload?.token_type!==undefined&&(typeof payload.token_type!=='string'||payload.token_type.toLowerCase()!=='bearer')))
  return acceptSavedCredentials(config,await finish('unconfirmed'))
 const tokens={...refreshedScopeEvidence(payload!),accessToken:access,expiresAt:new Date(Date.now()+expires*1000).toISOString(),...(typeof refresh==='string'?{refreshToken:refresh}:{})}
 return acceptSavedCredentials(config,await finish('success',tokens))
}
