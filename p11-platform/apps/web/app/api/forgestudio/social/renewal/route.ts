import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyManagerAccess} from '@/utils/services/auth-guard'
import {renewSocialConnection} from '@/utils/forgestudio/renewal'
import {ContentStoreError} from '@/utils/forgestudio/content-store'
const querySchema=z.object({propertyId:z.string().uuid(),cursor:z.string().uuid().optional()})
const requestSchema=z.object({propertyId:z.string().uuid(),requestId:z.string().uuid(),connectionId:z.string().uuid(),expectedVersion:z.number().int().positive(),reason:z.string().trim().min(3).max(2000)}).strict()
export async function GET(request:NextRequest){
 try{
  const {data:{user},error}=await(await createClient()).auth.getUser();if(error||!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const query=new URL(request.url).searchParams,p=querySchema.safeParse({propertyId:query.get('propertyId'),cursor:query.get('cursor')??undefined});if(!p.success)return NextResponse.json({error:'Invalid request'},{status:400})
  if(!(await validatePropertyManagerAccess(user.id,p.data.propertyId)).authorized)return NextResponse.json({error:'Manager access is required to review access renewal.'},{status:403})
  const db=createServiceClient();let q=db.from('forgestudio_renewals').select('id,connection_id,connection_version,platform,state,reason,created_at,finished_at').eq('property_id',p.data.propertyId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(31)
  if(p.data.cursor){const {data:anchor,error}=await db.from('forgestudio_renewals').select('id,created_at').eq('property_id',p.data.propertyId).eq('id',p.data.cursor).maybeSingle();if(error)throw new Error('Cursor unavailable');if(!anchor)return NextResponse.json({error:'Renewal history changed. Reload its first page.'},{status:409});q=q.or(`created_at.lt.${anchor.created_at},and(created_at.eq.${anchor.created_at},id.lt.${anchor.id})`)}
  const {data,error:readError}=await q;if(readError)throw new Error('History unavailable');const rows=(data??[]).slice(0,30)
  return NextResponse.json({renewals:rows,nextCursor:(data?.length??0)>30?rows.at(-1)?.id:null})
 }catch{return NextResponse.json({error:'Saved access renewal history could not be loaded. Reload its saved state.'},{status:503})}
}
export async function POST(request:NextRequest){
 try{
  const {data:{user},error}=await(await createClient()).auth.getUser();if(error||!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const p=requestSchema.safeParse(await request.json().catch(()=>null));if(!p.success)return NextResponse.json({error:'Choose the current account and a renewal reason.'},{status:400})
  if(!(await validatePropertyManagerAccess(user.id,p.data.propertyId)).authorized)return NextResponse.json({error:'Current manager access is required to renew account access.'},{status:403})
  const result=await renewSocialConnection(p.data,user.id);return NextResponse.json(result,{status:result.state==='exchanging'?202:200})
 }catch(error){return NextResponse.json({error:error instanceof ContentStoreError?error.message:'The access renewal result could not be confirmed. Reload saved history or retry the same decision.'},{status:error instanceof ContentStoreError?error.statusCode:503})}
}
