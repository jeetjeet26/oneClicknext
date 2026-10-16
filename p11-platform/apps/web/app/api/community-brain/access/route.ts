import {z} from 'zod'
import {brainActor,brainRpc} from '@/utils/community-brain/server'
import {BrainError} from '@/utils/community-brain/contracts'
import {boundedJson,brainFailure,privateHeaders,requireConsoleOrigin} from '@/utils/community-brain/http'
export const dynamic='force-dynamic'
const command=z.object({propertyId:z.guid(),actorId:z.guid(),capabilities:z.array(z.enum(['read','manage','generate','portfolio','download'])).min(1).max(5),expiresAt:z.iso.datetime().nullable(),revoke:z.boolean(),reason:z.string().trim().min(3).max(2000)}).strict()
export async function GET(request:Request){try{const actor=await brainActor(),propertyId=z.guid().parse(new URL(request.url).searchParams.get('propertyId'));return Response.json(await brainRpc('brain_read_access',{p_actor_id:actor,p_property_id:propertyId}),{headers:privateHeaders})}catch(error){return brainFailure(error)}}
export async function POST(request:Request){try{
 requireConsoleOrigin(request);const actor=await brainActor(),parsed=command.safeParse(await boundedJson(request));if(!parsed.success)throw new BrainError('Choose a team member and explicit community permissions.',400)
 const input=parsed.data
 return Response.json(await brainRpc('brain_set_access',{p_actor_id:actor,p_property_id:input.propertyId,p_target_actor_id:input.actorId,p_capabilities:input.capabilities,p_expires_at:input.expiresAt,p_revoke:input.revoke,p_reason:input.reason}),{headers:privateHeaders})
}catch(error){return brainFailure(error)}}
