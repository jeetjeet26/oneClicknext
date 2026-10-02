import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyManagerAccess} from '@/utils/services/auth-guard'
import {ContentStoreError,reviewPublicationRecovery} from '@/utils/forgestudio/content-store'
const schema=z.object({requestId:z.string().uuid(),expectedUpdatedAt:z.string().datetime({offset:true}),action:z.enum(['resume_before_send','record_existing_post']),reason:z.string().trim().min(10).max(2000),providerPostId:z.string().regex(/^[a-zA-Z0-9_:.\-]{1,300}$/).optional(),providerPostUrl:z.string().url().startsWith('https://').max(2000).optional()}).superRefine((value,ctx)=>{if(value.action==='record_existing_post'&&(!value.providerPostId||!value.providerPostUrl))ctx.addIssue({code:'custom',message:'Enter the existing post identity and HTTPS URL'})})
export async function POST(request:NextRequest,{params}:{params:Promise<{publicationId:string}>}){
 try{
  const {data:{user},error:authError}=await (await createClient()).auth.getUser()
  if(authError||!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const {publicationId}=await params
  const parsed=schema.safeParse(await request.json().catch(()=>null))
  if(!parsed.success)return NextResponse.json({error:'Choose a recovery decision and explain the checked evidence.'},{status:400})
  const {data:publication,error}=await createServiceClient().from('social_publications').select('property_id').eq('id',publicationId).single()
  if(error||!publication)return NextResponse.json({error:'Publication not found'},{status:404})
  const access=await validatePropertyManagerAccess(user.id,publication.property_id)
  if(!access.authorized)return NextResponse.json({error:'A property manager must review this publication.'},{status:403})
  const result=await reviewPublicationRecovery(publicationId,user.id,parsed.data)
  return NextResponse.json({result})
 }catch(error){
  if(error instanceof ContentStoreError)return NextResponse.json({error:error.message},{status:error.statusCode})
  return NextResponse.json({error:'The review could not be confirmed. Retry the same decision to recover its saved result.'},{status:500})
 }
}
