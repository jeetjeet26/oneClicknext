import 'server-only'
import type OpenAI from 'openai'
import {BrainError,type CommunityScope} from './contracts'
import {brainRpc,resolveCommunityScope} from './server'
import {requireGenerationCurrent} from './generation'
type ProviderObject={id:string;object_id:string;object_kind:'input_file'|'output_file'|'response'|'conversation'|'container';parents:string[];state:string;project_ref:string}
export type ProviderTask={scope:CommunityScope;contextId?:string;sessionId?:string}
export async function packageProviderTask(job:{id:string;actor_id:string;property_id:string;brain_context_id?:string|null}){
 providerProject()
 await requireGenerationCurrent('site_package',job.id)
 if(!job.brain_context_id)throw new BrainError('This legacy build needs a current source manifest.',409)
 return {scope:await resolveCommunityScope(job.actor_id,job.property_id,'site'),contextId:job.brain_context_id} satisfies ProviderTask
}
export const providerProject=()=>{const id=process.env.OPENAI_PROJECT_ID;if(!id||!/^proj_[A-Za-z0-9_-]+$/.test(id))throw new BrainError('The provider project identity must be configured before community generation.',503);return id}
export async function recordProviderObject(task:ProviderTask,kind:ProviderObject['object_kind'],objectId:string,parents:string[]=[],retentionSeconds=86400){
 return brainRpc<ProviderObject>('brain_provider_record',{p_scope_id:task.scope.id,p_input:{provider:'openai',project:providerProject(),kind,objectId,parents,contextId:task.contextId??null,sessionId:task.sessionId??null,policyRevision:'community-provider-v1',expiresAt:new Date(Date.now()+retentionSeconds*1000).toISOString()}})
}
export async function readProviderObject(task:ProviderTask,kind:ProviderObject['object_kind'],objectId:string){
 return brainRpc<ProviderObject>('brain_provider_lookup',{p_scope_id:task.scope.id,p_project:providerProject(),p_kind:kind,p_object_id:objectId,p_context_id:task.contextId??null,p_session_id:task.sessionId??null})
}
/** A citation is model content. Only a container in the provider's executed tool trace may supply bytes. */
export function executedContainerIds(response:OpenAI.Responses.Response){
 return new Set(response.output.flatMap(item=>item.type==='shell_call'&&item.environment?.type==='container_reference'?[item.environment.container_id]:item.type==='code_interpreter_call'?[item.container_id]:[]))
}
export async function cleanupProviderObjects(client:OpenAI){
 const due=await brainRpc<ProviderObject[]>('brain_provider_cleanup',{})
 const results:Array<{id:string;confirmed:boolean}>=[]
 for(const item of due){
  if(item.project_ref!==providerProject())continue
  let confirmed=false
  try{
   if(item.object_kind==='input_file')confirmed=(await client.files.delete(item.object_id)).deleted
   else if(item.object_kind==='response'){await client.responses.delete(item.object_id);confirmed=true}
   else if(item.object_kind==='container'){await client.containers.delete(item.object_id);confirmed=true}
   // Output files are removed by their registered parent container. Confirm its deletion receipt first.
   else if(item.object_kind==='output_file')confirmed=await brainRpc<boolean>('brain_provider_parent_deleted',{p_id:item.id})
   else if(item.object_kind==='conversation'){await client.conversations.delete(item.object_id);confirmed=true}
  }catch(error){confirmed=error instanceof Error&&'status'in error&&(error as {status?:number}).status===404}
  await brainRpc('brain_provider_cleanup',{p_id:item.id,p_confirmed:confirmed});results.push({id:item.id,confirmed})
 }
 return results
}
