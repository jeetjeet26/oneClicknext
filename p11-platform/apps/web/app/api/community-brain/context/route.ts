import {BrainError,contextRequestSchema} from '@/utils/community-brain/contracts'
import {brainActor,resolveCommunityScope,getCommunityContext} from '@/utils/community-brain/server'
export const runtime='nodejs'
export const dynamic='force-dynamic'
import {privateHeaders as headers,boundedJson,requireConsoleOrigin,brainFailure} from '@/utils/community-brain/http'
export async function POST(request:Request) {
  try {
    requireConsoleOrigin(request)
    const actor=await brainActor(),parsed=contextRequestSchema.safeParse(await boundedJson(request))
    if(!parsed.success)throw new BrainError('Choose a community, purpose and valid asset selection.',400)
    const scope=await resolveCommunityScope(actor,parsed.data.propertyId,parsed.data.purpose)
    return Response.json(await getCommunityContext(scope,parsed.data),{headers})
  } catch(error) {return brainFailure(error)}
}
