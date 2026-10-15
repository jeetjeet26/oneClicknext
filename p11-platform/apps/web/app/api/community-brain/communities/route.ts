import {brainActor,brainRpc} from '@/utils/community-brain/server'
import {brainFailure,privateHeaders} from '@/utils/community-brain/http'
export const dynamic='force-dynamic'
export async function GET(request:Request){try{const actor=await brainActor(),capability=new URL(request.url).searchParams.get('portfolio')==='true'?'portfolio':'read';return Response.json({communities:await brainRpc('brain_list_communities',{p_actor_id:actor,p_capability:capability})},{headers:privateHeaders})}catch(error){return brainFailure(error)}}
