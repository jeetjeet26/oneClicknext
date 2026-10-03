import { NextRequest } from 'next/server'
import { z } from 'zod'
import { leadpulseRpc, leadpulseScope, leadpulseUser, reply, resultReply, unconfirmed } from '@/utils/leadpulse/server'
const schema = z.object({ propertyId:z.string().min(1).max(100),leadId:z.string().min(1).max(100),scoreId:z.string().uuid(),requestId:z.string().uuid(),judgment:z.enum(['useful','too_high','too_low','insufficient_evidence']),reason:z.string().trim().min(3).max(500) }).strict()
export async function GET(req:NextRequest) {
 try {
  const user=await leadpulseUser();if(!user)return reply({error:'Unauthorized'},401)
  const leadId=req.nextUrl.searchParams.get('leadId');if(!leadId)return reply({error:'Lead required'},400)
  const scope=await leadpulseScope(user.id,{leadId});if(scope.response)return scope.response
  return resultReply(await leadpulseRpc('read_lead_score_reviews',{p_property_id:scope.propertyId,p_lead_id:leadId,p_actor_id:user.id}))
 } catch {return unconfirmed()}
}
export async function POST(req:NextRequest) {
 try {
  const user=await leadpulseUser();if(!user)return reply({error:'Unauthorized'},401)
  const parsed=schema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return reply({error:'Review a saved score with a judgment and reason.'},400)
  const body=parsed.data,scope=await leadpulseScope(user.id,body);if(scope.response)return scope.response
  return resultReply(await leadpulseRpc('review_lead_score',{p_property_id:scope.propertyId,p_lead_id:body.leadId,p_actor_id:user.id,p_score_id:body.scoreId,p_request_id:body.requestId,p_judgment:body.judgment,p_reason:body.reason}))
 } catch {return unconfirmed()}
}
