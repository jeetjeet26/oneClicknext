import{createServiceClient}from'@/utils/supabase/admin'
import{InventoryError,inventoryActor}from'@/utils/knowledge/inventory'
import{currentTeamOrganization}from'@/utils/team/store'
import type{AccountCommand}from'./contracts'
export{InventoryError as AccountSettingsError,inventoryActor as accountActor,currentTeamOrganization as currentAccountOrganization}
type Client={rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}
async function invoke(name:string,args:Record<string,unknown>,client:unknown=createServiceClient()){
 const{data,error}=await(client as Client).rpc(name,args);if(error||!data)throw new InventoryError('Account settings could not be confirmed. Check the saved decision before retrying.')
 const messages:Record<string,string>={forbidden:'These account settings are unavailable with your current organization permissions.',settings_changed:'These saved settings changed. Reload and review the current values.',request_conflict:'This request differs from its saved settings decision.',decision_cancelled:'This unused settings request was cancelled.',history_changed:'The saved settings history changed. Reload before continuing.',not_found:'The selected settings decision is unavailable.'}
 if(!['ready','saved','replayed'].includes(String(data.state)))throw new InventoryError(messages[String(data.state)]||'Account settings could not be verified.',data.state==='forbidden'?403:data.state==='not_found'?404:409)
 if(data.orgId!==args.p_org_id||data.actorId!==args.p_actor_id)throw new InventoryError('The settings receipt does not match this account.')
 return data
}
export function readAccountSettings(actor:string,orgId:string,input:Record<string,unknown>={},client?:unknown){return invoke('read_account_settings',{p_actor_id:actor,p_org_id:orgId,p_input:input},client)}
export function decideAccountSettings(actor:string,command:AccountCommand,client?:unknown){const{requestId,orgId,...input}=command;return invoke('decide_account_settings',{p_id:requestId,p_org_id:orgId,p_actor_id:actor,p_input:input},client)}
