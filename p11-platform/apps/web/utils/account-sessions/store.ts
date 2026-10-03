import {createServiceClient} from '@/utils/supabase/admin'
import {InventoryError} from '@/utils/knowledge/inventory'
import type {SessionCommand,SessionReceipt,SessionSource} from './contracts'
export {InventoryError as SessionError}
export type SessionActor={actorId:string;sessionId:string;aal:string}
type RpcClient={rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}
export async function sessionRpc(name:string,args:Record<string,unknown>,client:unknown=createServiceClient()){
 const {data,error}=await(client as RpcClient).rpc(name,args)
 if(error||!data)throw new InventoryError('The session result could not be recorded or read. Check its saved request before doing anything else.')
 const messages:Record<string,string>={forbidden:'This session is no longer available. Sign in again to review your private history.',existing_request:'This session already has a sign-out request. Open its private history to check it.',not_found:'This session request is not recorded for your account.',sessions_changed:'Your session list changed. Reload it before reviewing a new request.',request_conflict:'This request differs from its recorded session decision.',mfa_required:'Verify your second factor before changing sessions.',no_other_sessions:'There are no other sessions to sign out.',history_changed:'Session history changed. Reload it before continuing.'}
 if(!['ready','saved','replayed','claimed'].includes(String(data.state)))throw new InventoryError(messages[String(data.state)]||'The session result could not be verified.',data.state==='forbidden'?401:data.state==='not_found'?404:409)
 if(data.actorId!==args.p_actor_id)throw new InventoryError('The session receipt does not match your account.')
 return data
}
export async function readSessions(actor:SessionActor,input:Record<string,unknown>={},client?:unknown){return sessionRpc('read_account_sessions',{p_actor_id:actor.actorId,p_session_id:actor.sessionId,p_aal:actor.aal,p_input:input},client)}
export async function sessionDecision(actor:SessionActor,command:SessionCommand,client?:unknown){
 if(command.operation!=='revoke')return sessionRpc('review_account_session',{p_id:command.requestId,p_actor_id:actor.actorId,p_session_id:actor.sessionId,p_operation:command.operation},client)
 return sessionRpc('claim_account_session',{p_id:command.requestId,p_actor_id:actor.actorId,p_session_id:actor.sessionId,p_aal:actor.aal,p_input:{scope:command.scope,sourceHash:command.sourceHash,confirmed:true}},client)
}
export async function finishSession(actor:SessionActor,id:string,claimId:string,outcome:string,client?:unknown){return sessionRpc('finish_account_session',{p_id:id,p_actor_id:actor.actorId,p_claim_id:claimId,p_outcome:outcome},client)}
// Only an explicit provider rejection is definitive. Network/5xx failures can hide a completed effect.
export function providerSessionOutcome(error:{status?:number}|null){return !error?'acknowledged':[400,401,403,404,422,429].includes(error.status||0)?'rejected':'uncertain'}
export async function executeSessionDecision(actor:SessionActor,command:SessionCommand,provider:(scope:'local'|'others')=>Promise<{error:{status?:number}|null}>,client?:unknown){
 const claimed=await sessionDecision(actor,command,client)
 if(claimed.state!=='claimed')return claimed as unknown as SessionReceipt
 if(command.operation!=='revoke'||claimed.requestId!==command.requestId||typeof claimed.claimId!=='string')throw new InventoryError('The session execution claim could not be verified.')
 let outcome:string
 try{outcome=providerSessionOutcome((await provider(command.scope)).error)}catch{outcome='uncertain'}
 const result=await finishSession(actor,command.requestId,claimed.claimId,outcome,client)
 return result as unknown as SessionReceipt
}
export type {SessionReceipt,SessionSource}
