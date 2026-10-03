import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {readReplacementReview,requestReplacement,replacementMessages} from '@/utils/services/integration-replacement'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const context=z.object({propertyId:z.string().regex(uuid),capability:z.enum(['calendar','email'])})
const decision=context.extend({requestId:z.string().regex(uuid),provider:z.enum(['google','microsoft']),accountEmail:z.string().trim().email().max(320),revision:z.string().regex(/^[a-f0-9]{64}$/),acknowledgeHistory:z.literal(true)}).strict()
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}})
async function access(propertyId:string){
 const client=await createClient(),{data:{user},error}=await client.auth.getUser()
 if(error||!user)return {response:json({error:'Unauthorized'},401)}
 if(!(await validatePropertyAccess(user.id,propertyId)).authorized)return {response:json({error:'Forbidden'},403)}
 return {actorId:user.id}
}
export async function GET(request:NextRequest){
 const parsed=context.safeParse(Object.fromEntries(request.nextUrl.searchParams))
 if(!parsed.success)return json({error:'Choose a property and calendar or email access.'},400)
 try{const allowed=await access(parsed.data.propertyId);if(allowed.response)return allowed.response
  return json(await readReplacementReview(parsed.data.propertyId,allowed.actorId,parsed.data.capability))
 }catch{return json({error:'Replacement review is unavailable. Retry to load the current account and linked work.'},503)}
}
export async function POST(request:NextRequest){
 const parsed=decision.safeParse(await request.json().catch(()=>null))
 if(!parsed.success)return json({error:'Review the current account, enter the replacement account, and confirm how history will be kept.'},400)
 try{const allowed=await access(parsed.data.propertyId);if(allowed.response)return allowed.response
  const result=await requestReplacement({...parsed.data,actorId:allowed.actorId})
  if(!['ready','replayed'].includes(String(result.state)))return json({...result,error:replacementMessages[String(result.state)]||'The account replacement is unavailable. Reload the review.'},result.state==='forbidden'?403:409)
  const query=new URLSearchParams({propertyId:parsed.data.propertyId,capabilities:parsed.data.capability,replacementId:parsed.data.requestId})
  return json({...result,startUrl:`/api/lumaleasing/integrations/oauth/${parsed.data.provider}/start?${query}`})
 }catch{return json({error:'The replacement decision could not be confirmed. Retry the same request.'},503)}
}
