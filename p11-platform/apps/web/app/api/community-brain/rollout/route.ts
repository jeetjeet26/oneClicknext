import {z}from'zod'
import {brainActor,brainRpc}from'@/utils/community-brain/server'
import {boundedJson,brainFailure,privateHeaders,requireConsoleOrigin}from'@/utils/community-brain/http'
export const dynamic='force-dynamic'
export async function GET(request:Request){try{
 const propertyId=z.guid().parse(new URL(request.url).searchParams.get('propertyId'))
 return Response.json(await brainRpc('brain_rollout',{p_actor_id:await brainActor(),p_property_id:propertyId,p_input:null}),{headers:privateHeaders})
}catch(e){return brainFailure(e)}}
export async function POST(request:Request){try{
 requireConsoleOrigin(request)
 const input=z.object({propertyId:z.guid(),settings:z.object({revision:z.number().int().positive(),context:z.boolean(),ingestion:z.boolean(),portfolio:z.boolean(),privateDelivery:z.boolean(),feedback:z.boolean(),consumers:z.array(z.enum(['site','chat','social','brand'])).max(4),reason:z.string().trim().min(3).max(2000)}).strict()}).strict().parse(await boundedJson(request))
 return Response.json(await brainRpc('brain_rollout',{p_actor_id:await brainActor(),p_property_id:input.propertyId,p_input:input.settings}),{headers:privateHeaders})
}catch(e){return brainFailure(e)}}
