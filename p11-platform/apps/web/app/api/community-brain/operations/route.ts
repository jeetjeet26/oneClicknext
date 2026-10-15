import { z } from 'zod'
import { brainActor, brainRpc, resolveCommunityScope, requireCurrentScope } from '@/utils/community-brain/server'
import { brainFailure, privateHeaders } from '@/utils/community-brain/http'
export const dynamic='force-dynamic'
export async function GET(request:Request){try{
 const propertyId=z.uuid().parse(new URL(request.url).searchParams.get('propertyId')),actor=await brainActor(),scope=await resolveCommunityScope(actor,propertyId,'research')
 const [health,channels,budgets]=await Promise.all([brainRpc('brain_operational_status',{p_scope_id:scope.id}),brainRpc('brain_channel_readiness',{p_scope_id:scope.id}),brainRpc('brain_read_processing_budgets',{p_scope_id:scope.id})])
 await requireCurrentScope(scope,propertyId)
 return Response.json({health,channels,budgets},{headers:privateHeaders})
}catch(error){return brainFailure(error)}}
