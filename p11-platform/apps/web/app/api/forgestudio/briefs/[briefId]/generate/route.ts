import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {ContentStoreError} from '@/utils/forgestudio/content-store'
import {runBriefGeneration} from '@/utils/forgestudio/generation-store'
import {GenerationClaimError} from '@/utils/forgestudio/generation'
export const maxDuration=180
export async function POST(request:NextRequest,{params}:{params:Promise<{briefId:string}>}){
 try{
  const {data:{user},error:authError}=await (await createClient()).auth.getUser()
  if(authError||!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const parsed=z.object({requestId:z.string().uuid()}).safeParse(await request.json().catch(()=>null))
  if(!parsed.success)return NextResponse.json({error:'A saved generation request identity is required.'},{status:400})
  const {briefId}=await params
  const {data:brief,error}=await createServiceClient().from('social_content_briefs').select('property_id,org_id').eq('id',briefId).single()
  if(error||!brief)return NextResponse.json({error:'Brief not found'},{status:404})
  const access=await validatePropertyAccess(user.id,brief.property_id)
  if(!access.authorized||access.orgId!==brief.org_id)return NextResponse.json({error:'Forbidden'},{status:403})
  const result=await runBriefGeneration({requestId:parsed.data.requestId,briefId,propertyId:brief.property_id,actorId:user.id})
  const success=['saved','replayed','completed'].includes(String(result.state))
  const pending=['preparing','ready','generating','result_ready','busy'].includes(String(result.state))
  return NextResponse.json({result,...(!success?{error:pending?'This request already exists. Reload its saved status; no second model run was started.':'Review the saved request before starting another generation.'}:{})},{status:success?201:pending?202:409,headers:{'Cache-Control':'no-store'}})
 }catch(error){
  if(error instanceof GenerationClaimError)return NextResponse.json({error:'The saved model result contains unsupported claims. Review the brief and source evidence before starting a new request.',unsupportedClaims:error.unsupportedClaims},{status:422})
  if(error instanceof ContentStoreError)return NextResponse.json({error:error.message},{status:error.statusCode})
  return NextResponse.json({error:'Generation could not be confirmed. Reload the saved request to recover any saved result before starting again.'},{status:503})
 }
}
