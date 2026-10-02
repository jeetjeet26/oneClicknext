import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {ContentStoreError} from '@/utils/forgestudio/content-store'
import {GenerationClaimError} from '@/utils/forgestudio/generation'
import {generationRpc,recoverGeneration} from '@/utils/forgestudio/generation-store'
const schema=z.discriminatedUnion('action',[z.object({action:z.literal('recover'),requestId:z.string().uuid()}),z.object({action:z.literal('stop'),requestId:z.string().uuid(),expectedUpdatedAt:z.string().datetime({offset:true}),reason:z.string().trim().min(10).max(2000)})])
export async function POST(request:NextRequest,{params}:{params:Promise<{generationId:string}>}){
 try{
  const {data:{user},error:authError}=await (await createClient()).auth.getUser()
  if(authError||!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const body=schema.safeParse(await request.json().catch(()=>null));if(!body.success)return NextResponse.json({error:'Choose a valid saved request decision.'},{status:400})
  const {generationId}=await params
  const {data:run,error}=await createServiceClient().from('forgestudio_generations').select('property_id,org_id').eq('id',generationId).single()
  if(error||!run)return NextResponse.json({error:'Generation request not found'},{status:404})
  const access=await validatePropertyAccess(user.id,run.property_id)
  if(!access.authorized||access.orgId!==run.org_id)return NextResponse.json({error:'Forbidden'},{status:403})
  const result=body.data.action==='recover'?await recoverGeneration(generationId,run.property_id,user.id,body.data.requestId):await generationRpc('stop_forgestudio_generation',{p_id:body.data.requestId,p_property_id:run.property_id,p_actor_id:user.id,p_payload:{generationId,expectedUpdatedAt:body.data.expectedUpdatedAt,reason:body.data.reason}})
  const ok=['saved','replayed'].includes(String(result.state))
  return NextResponse.json({result,...(!ok?{error:'The saved request changed. Reload its status before making another decision.'}:{})},{status:ok?200:409})
 }catch(error){
  if(error instanceof ContentStoreError)return NextResponse.json({error:error.message},{status:error.statusCode})
  if(error instanceof GenerationClaimError)return NextResponse.json({error:'The saved result contains unsupported claims. Stop this request and revise the brief or its approved sources before a new generation.'},{status:422})
  return NextResponse.json({error:'The decision could not be confirmed. Reload the saved request; no new model run was started.'},{status:503})
 }
}
