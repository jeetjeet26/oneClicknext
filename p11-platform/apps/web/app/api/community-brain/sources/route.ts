import { z } from 'zod'
import { brainActor, brainRpc, requireCurrentScope, resolveCommunityScope } from '@/utils/community-brain/server'
import { syncConnectedFiles } from '@/utils/community-brain/connected-files'
import { boundedJson, brainFailure, privateHeaders, requireConsoleOrigin } from '@/utils/community-brain/http'
import { createServiceClient } from '@/utils/supabase/admin'
export const dynamic = 'force-dynamic'
export const maxDuration = 300
export async function GET(request: Request) {
  try {
    const actor = await brainActor(), propertyId = z.uuid().parse(new URL(request.url).searchParams.get('propertyId'))
    const scope = await resolveCommunityScope(actor, propertyId, 'research')
    const { data, error } = await createServiceClient().from('siteforge_asset_sources').select('id,provider,status,external_folder_name,last_synced_at,last_error').eq('property_id',propertyId).in('provider',['google_drive','dropbox']).order('created_at').limit(100)
    if (error) throw new Error('Source inventory unavailable')
    await requireCurrentScope(scope,propertyId)
    const {data:schedules,error:scheduleError}=await createServiceClient().from('community_source_schedules').select('source_id,enabled,interval_hours,revision,next_due_at,last_state').eq('property_id',propertyId)
    if(scheduleError)throw new Error('Source schedules unavailable')
    await requireCurrentScope(scope,propertyId)
    return Response.json({sources:data.map(source=>({...source,schedule:schedules.find(schedule=>schedule.source_id===source.id)??null}))},{headers:privateHeaders})
  } catch(error) { return brainFailure(error) }
}
export async function POST(request: Request) {
  try {
    requireConsoleOrigin(request)
    const actor=await brainActor(),input=z.object({propertyId:z.uuid(),sourceId:z.uuid()}).strict().parse(await boundedJson(request))
    return Response.json({run:await syncConnectedFiles(actor,input.propertyId,input.sourceId)},{headers:privateHeaders})
  } catch(error) { return brainFailure(error) }
}

export async function PATCH(request:Request){
  try{
    requireConsoleOrigin(request)
    const actor=await brainActor(),input=z.object({propertyId:z.uuid(),sourceId:z.uuid(),enabled:z.boolean(),hours:z.number().int().min(1).max(168),revision:z.number().int().min(0)}).strict().parse(await boundedJson(request))
    const scope=await resolveCommunityScope(actor,input.propertyId,'manage')
    const schedule=await brainRpc('brain_source_schedule',{p_scope_id:scope.id,p_source_id:input.sourceId,p_enabled:input.enabled,p_hours:input.hours,p_revision:input.revision})
    return Response.json({schedule},{headers:privateHeaders})
  }catch(error){return brainFailure(error)}
}
