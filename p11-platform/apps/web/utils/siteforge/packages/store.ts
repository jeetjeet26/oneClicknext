import { createClient as createSupabase } from '@supabase/supabase-js'
import { createClient } from '@/utils/supabase/server'
import { getSupabaseUrl,getSupabaseServiceRoleKey } from '@/utils/supabase/config'
import { validateSiteForgeOwnerOperatorAccess } from '@/utils/services/auth-guard'
import { PackageError, type PackageRequest, type PackageState } from './contracts'
import { loadPackageSource, sha256, stableJson, type PackageSource } from './source'
import type { Json } from '@/types/supabase'

export type PackageJob={
  id:string;property_id:string;org_id:string;actor_id:string;parent_id:string|null;target:'wordpress'|'standalone';
  instructions:string;request_hash:string;source_hash:string;source_snapshot:PackageSource;model:string;
  state:PackageState;response_id:string|null;input_file_id:string|null;input_path:string|null;
  package_path:string|null;package_hash:string|null;package_bytes:number|null;error_message:string|null;
  usage:Json|null;lease_until:string|null;created_at:string;updated_at:string;
}
// Domain projection narrows the generated JSON snapshot and SQL state strings for this worker.
type PackageDatabase={public:{Tables:{siteforge_package_jobs:{Row:PackageJob;Insert:Partial<PackageJob>;Update:Partial<PackageJob>;Relationships:[]}};Views:Record<string,never>;Functions:{record_siteforge_package_download:{Args:{p_property_id:string;p_job_id:string;p_actor_id:string};Returns:boolean}};Enums:Record<string,never>;CompositeTypes:Record<string,never>}}
export const packageDb=()=>createSupabase<PackageDatabase>(getSupabaseUrl(),getSupabaseServiceRoleKey(),{auth:{persistSession:false,autoRefreshToken:false}})
export async function requirePackageOperator(propertyId:string) {
  const {data:{user},error}=await(await createClient()).auth.getUser()
  if(error||!user) throw new PackageError('Sign in to generate or review a website.',401)
  const access=await validateSiteForgeOwnerOperatorAccess(user.id,propertyId)
  if(!access.authorized||!access.orgId) throw new PackageError('Website generation is available to this property’s internal managers.',403)
  return {id:user.id,orgId:access.orgId}
}
export async function getPackageJob(id:string,propertyId?:string) {
  let query=packageDb().from('siteforge_package_jobs').select('*').eq('id',id)
  if(propertyId) query=query.eq('property_id',propertyId)
  const {data,error}=await query.maybeSingle()
  if(error) throw new PackageError('The saved website build could not be loaded.')
  if(!data) throw new PackageError('Website build not found.',404)
  return data
}
export async function savePackageRequest(input:PackageRequest,actor:{id:string;orgId:string}) {
  const db=packageDb(),requestHash=sha256(stableJson({...input,actorId:actor.id}))
  const {data:existing,error:readError}=await db.from('siteforge_package_jobs').select('*').eq('id',input.requestId).maybeSingle()
  if(readError) throw new PackageError('Website generation storage is not ready.')
  if(existing) {
    if(existing.request_hash!==requestHash || existing.org_id!==actor.orgId) throw new PackageError('This request is already saved with different details. Reload before generating.',409)
    return existing
  }
  if(!process.env.OPENAI_API_KEY) throw new PackageError('Astra is not configured on this server yet. Your saved information has not been changed.')
  const {source,hash}=await loadPackageSource(input.propertyId)
  const {data,error}=await db.from('siteforge_package_jobs').insert({id:input.requestId,property_id:input.propertyId,org_id:actor.orgId,actor_id:actor.id,parent_id:input.parentId,target:input.target,instructions:input.instructions,request_hash:requestHash,source_hash:hash,source_snapshot:source}).select('*').single()
  if(error||!data) {
    if(error?.code==='23505') {
      const retry=await db.from('siteforge_package_jobs').select('*').eq('id',input.requestId).maybeSingle()
      if(retry.data?.request_hash===requestHash) return retry.data
      throw new PackageError('This property already has an active build. Review it before starting another.',409)
    }
    throw new PackageError('The website request could not be saved. Retry the same request.')
  }
  return data
}
export async function updatePackage(id:string,from:PackageState,patch:Partial<PackageJob>) {
  const {data,error}=await packageDb().from('siteforge_package_jobs').update(patch).eq('id',id).eq('state',from).select('*').maybeSingle()
  if(error||!data) throw new PackageError('The website build changed or its progress could not be saved.')
  return data
}
