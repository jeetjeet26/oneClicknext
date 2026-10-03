import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
export async function GET(request:NextRequest){
 try{
  const {data:{user},error:authError}=await (await createClient()).auth.getUser()
  if(authError||!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const params=new URL(request.url).searchParams,propertyId=params.get('propertyId'),cursor=params.get('cursor')
  let after:{at:string;id:string}|null=null
  if(cursor){try{after=z.object({at:z.string().datetime({offset:true}),id:z.string().uuid()}).parse(JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')))}catch{return NextResponse.json({error:'Invalid request history page. Reload saved requests.'},{status:400})}}
  if(!z.string().uuid().safeParse(propertyId).success)return NextResponse.json({error:'Choose a property.'},{status:400})
  const access=await validatePropertyAccess(user.id,propertyId!)
  if(!access.authorized||!access.orgId)return NextResponse.json({error:'Forbidden'},{status:403})
  let query=createServiceClient().from('forgestudio_generations').select('id,brief_id,state,package_id,revision_id,error_code,created_at,updated_at,claim_expires_at,raw_result_hash,social_content_briefs(title)').eq('property_id',propertyId!).eq('org_id',access.orgId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(51)
  if(after)query=query.or(`created_at.lt.${after.at},and(created_at.eq.${after.at},id.lt.${after.id})`)
  const {data,error}=await query
  if(error)throw error
  const rows=(data??[]).slice(0,50),last=rows.at(-1)
  const nextCursor=(data??[]).length>50&&last?Buffer.from(JSON.stringify({at:last.created_at,id:last.id})).toString('base64url'):null
  return NextResponse.json({requests:rows.map(row=>({...row,hasSavedResult:Boolean(row.raw_result_hash),raw_result_hash:undefined})),nextCursor},{headers:{'Cache-Control':'no-store'}})
 }catch{return NextResponse.json({error:'Saved generation requests could not be loaded. Reload to check their actual status.'},{status:503})}
}
