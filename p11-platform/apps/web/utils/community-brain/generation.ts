import 'server-only'
import {BrainError,type CommunityScope,type GenerationContext,type BrainPurpose} from './contracts'
import {brainRpc,resolveCommunityScope,requireCurrentScope} from './server'
export type SavedCommunityContext=GenerationContext&{snapshotId:string}
export type ServiceDeliverable={id:string;packageId:string;packageVersion:number;initiativeId:string;brief:Record<string,unknown>;deliverable:Record<string,unknown>;outputContract:Record<string,unknown>;reviewCriteria:Record<string,unknown>;context:SavedCommunityContext;mediaSpendAuthorized:false}

export async function saveGenerationContext(scope:CommunityScope,task:{propertyId:string;query:string;assetIds:string[]},expected?:GenerationContext){
 const context=await brainRpc<SavedCommunityContext>('brain_save_context',{p_scope_id:scope.id,p_property_id:task.propertyId,p_query:task.query,p_asset_ids:task.assetIds,p_job_id:null})
 if(expected&&context.readSetHash!==expected.readSetHash)throw new BrainError('Community sources changed during preparation. Refresh the brief.',409)
 if(context.scopeKind!=='community'||context.actorId!==scope.actor_id||context.propertyId!==task.propertyId||context.scopeId!==scope.id)throw new BrainError('The generation context does not belong to this task.',403)
 return context
}
export async function requireGenerationCurrent(kind:'site_package'|'social'|'shared',id:string){
 if(!await brainRpc<boolean>('brain_generation_current',{p_kind:kind,p_id:id}))throw new BrainError('Approved sources or access changed. Prepare a current generation brief.',409)
}
export async function readServiceDeliverable(actorId:string,propertyId:string,purpose:Exclude<BrainPurpose,'portfolio'>,id:string){
 const scope=await resolveCommunityScope(actorId,propertyId,purpose)
 const brief=await brainRpc<ServiceDeliverable>('brain_read_deliverable',{p_scope_id:scope.id,p_id:id})
 await requireCurrentScope(scope,propertyId)
 return brief
}
