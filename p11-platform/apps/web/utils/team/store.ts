import {randomBytes,createHash}from 'node:crypto'
import {createServiceClient}from '@/utils/supabase/admin'
import {InventoryError,inventoryActor}from '@/utils/knowledge/inventory'
import type {TeamCommand,JoinCommand}from './contracts'
export {InventoryError as TeamError,inventoryActor as teamActor}
export const invitationTokenHash=(token:string)=>createHash('sha256').update(token).digest('hex')
type Client={rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}
const messages:Record<string,string>={forbidden:'Team access is unavailable with your current organization permissions.',not_found:'The selected team member or decision is unavailable.',team_changed:'The team or selected member changed. Reload before reviewing access.',last_admin:'Keep another verified, available administrator before changing this access.',self_removal:'Ask another administrator to review removal of your organization access.',no_change:'Choose a different role to record a change.',request_conflict:'This request differs from its saved team decision.',decision_cancelled:'This unused team request was cancelled.',history_changed:'The team history changed. Reload before continuing.',invitation_exists:'An active invitation already exists for this email. Review or replace that invitation.',already_member:'This account is already a member of the organization.',invitation_changed:'The saved invitation changed. Review its current recipient, role and expiration.',invitation_finished:'This invitation has already been accepted, declined or revoked.',invitation_unavailable:'This invitation is unavailable, expired or replaced. Ask the administrator for a current link.',verified_account_required:'Verify your account email before reviewing this invitation.',recipient_mismatch:'Sign in with the verified email address the invitation was created for.',issuer_unavailable:'The invitation issuer no longer has permission. Ask a current administrator for a reviewed replacement.',other_organization:'This account already belongs to another organization. Its membership cannot be moved by this invitation.'}
export async function teamRpc(name:string,args:Record<string,unknown>,client:unknown=createServiceClient()){
 const {data,error}=await(client as Client).rpc(name,args)
 if(error||!data)throw new InventoryError('The team decision could not be confirmed. Check its saved result before retrying.')
 if(!['ready','saved','replayed'].includes(String(data.state)))throw new InventoryError(messages[String(data.state)]||'Team access could not be verified.',['forbidden','verified_account_required','recipient_mismatch'].includes(String(data.state))?403:data.state==='not_found'?404:409)
 if(args.p_org_id&&data.orgId!==args.p_org_id)throw new InventoryError('The team receipt does not match this organization.')
 return data
}
export async function currentTeamOrganization(actor:string,client=createServiceClient()){
 const {data,error}=await client.from('profiles').select('org_id').eq('id',actor).single()
 if(error||!data)throw new InventoryError('Your current organization could not be read.')
 if(!data.org_id)throw new InventoryError('Join or create an organization before opening its team.',403)
 return data.org_id
}
export function readTeam(actor:string,orgId:string,input:Record<string,unknown>,client?:unknown){return teamRpc('read_team_access',{p_actor_id:actor,p_org_id:orgId,p_input:input},client)}
export async function decideTeam(actor:string,command:TeamCommand,client:unknown=createServiceClient()){
 const{requestId,orgId,...input}=command
 if(command.operation==='report_link_copy')return teamRpc('report_team_invitation_copy',{p_id:requestId,p_org_id:orgId,p_actor_id:actor,p_source_decision_id:command.sourceDecisionId,p_outcome:command.outcome},client)
 const createsLink=['create_invitation','rotate_invitation'].includes(command.operation),token=createsLink?randomBytes(32).toString('hex'):null
 const result=await teamRpc('decide_team_access',{p_id:requestId,p_org_id:orgId,p_actor_id:actor,p_input:input,...(token?{p_token_hash:invitationTokenHash(token)}:{})},client)
 // A replay cannot reveal a replacement secret for a previously saved invitation.
 return result.state==='saved'&&token?{...result,invitationToken:token}:result
}
export function readTeamJoin(actor:string,token:string|null,decisionId?:string,client?:unknown){return teamRpc('read_team_join',{p_actor_id:actor,...(decisionId?{p_decision_id:decisionId}:{}),...(token?{p_token_hash:invitationTokenHash(token)}:{})},client)}
export function decideTeamJoin(actor:string,token:string|null,command:JoinCommand,client?:unknown){const{requestId,...input}=command;if(command.operation==='cancel_unused')return teamRpc('cancel_team_join',{p_id:requestId,p_actor_id:actor,p_token_hash:token?invitationTokenHash(token):null,p_input_hash:command.inputHash},client);return teamRpc('decide_team_join',{p_id:requestId,p_actor_id:actor,p_token_hash:token?invitationTokenHash(token):null,p_input:input},client)}
