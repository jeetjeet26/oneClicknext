import {createServiceClient} from '@/utils/supabase/admin'
import {InventoryError} from '@/utils/knowledge/inventory'
import type {SessionActor} from '@/utils/account-sessions/store'
import type {CredentialCommand,CredentialReceipt} from './contracts'
export {InventoryError as CredentialError}
type RpcClient={rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}
export async function credentialRpc(name:string,args:Record<string,unknown>,client:unknown=createServiceClient()){
 const{data,error}=await(client as RpcClient).rpc(name,args)
 if(error||!data)throw new InventoryError('The password request could not be recorded or read. Check its saved result before trying again.')
 const messages:Record<string,string>={recovery_required:'Open a fresh recovery link from your email before resetting your password.',recovery_consumed:'This recovery link has already been used to reset your password. Request a new link for another reset.',forbidden:'Sign in again to review your private password history.',not_found:'This password request is not recorded for your account.',mfa_required:'Verify your second factor before changing your password.',credentials_changed:'Your account security history changed. Reload before reviewing another request.',request_conflict:'This request differs from its saved security review.',pending_request:'Check or cancel your earlier password request before starting another.',rate_limited:'Too many password verification attempts. Wait ten minutes before starting another.',history_changed:'Password history changed. Reload before continuing.'}
 if(!['ready','saved','replayed','claimed','execute'].includes(String(data.state)))throw new InventoryError(messages[String(data.state)]||'The password request could not be verified.',data.state==='forbidden'?401:data.state==='not_found'?404:data.state==='rate_limited'?429:409)
 if(data.actorId!==args.p_actor_id)throw new InventoryError('The password receipt does not match your account.')
 if(args.p_id&&data.requestId!==args.p_id)throw new InventoryError('The password receipt does not match your request.')
 return data
}
export function readCredentials(actor:SessionActor,input:Record<string,unknown>={},client?:unknown){return credentialRpc('read_account_credentials',{p_actor_id:actor.actorId,p_session_id:actor.sessionId,p_aal:actor.aal,p_input:input},client)}
export type CredentialProvider={verify:(password:string)=>Promise<{verified:boolean;cleanup:'confirmed'|'not_created'|'unconfirmed'}>;change:(password:string,claim:string)=>Promise<{data:{user:{id:string}|null};error:{status?:number}|null}>}
export async function executeCredential(actor:SessionActor,command:CredentialCommand,provider:CredentialProvider,client?:unknown){
 const args={p_id:command.requestId,p_actor_id:actor.actorId,p_session_id:actor.sessionId}
 if(command.operation!=='change'&&command.operation!=='reset')return await credentialRpc('review_account_credential',{...args,p_operation:command.operation},client) as unknown as CredentialReceipt
 const claimed=await credentialRpc(command.operation==='reset'?'claim_account_recovery':'claim_account_credential',{...args,p_aal:actor.aal,p_source_hash:command.sourceHash},client)
 if(claimed.state!=='claimed')return claimed as unknown as CredentialReceipt
 if(typeof claimed.claimId!=='string')throw new InventoryError('Password verification could not acquire its saved request.')
 const claim={p_id:command.requestId,p_actor_id:actor.actorId,p_claim_id:claimed.claimId}
 if(command.operation==='change'){
 let verification:{verified:boolean;cleanup:'confirmed'|'not_created'|'unconfirmed'}
 try{verification=await provider.verify(command.currentPassword)}catch{verification={verified:false,cleanup:'unconfirmed'}}
 const advanced=await credentialRpc('advance_account_credential',{...claim,p_aal:actor.aal,p_verified:verification.verified,p_cleanup:verification.cleanup},client)
 if(advanced.state!=='execute')return advanced as unknown as CredentialReceipt
 }
 let outcome='uncertain'
 try{const r=await provider.change(command.newPassword,claimed.claimId);if(r.error&&[400,401,403,404,422,429].includes(r.error.status||0))outcome='rejected'}catch{/* Native provider-transaction evidence remains authoritative after a lost reply. */}
 // A 200 reply alone cannot invent confirmation. Only the atomic Auth commit can confirm.
 return await credentialRpc('finish_account_credential',{...claim,p_outcome:outcome},client) as unknown as CredentialReceipt
}
