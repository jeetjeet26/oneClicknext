import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyManagerAccess} from '@/utils/services/auth-guard'
import {socialRpc} from '@/utils/forgestudio/social-security'
import {ContentStoreError} from '@/utils/forgestudio/content-store'
const querySchema=z.object({propertyId:z.string().uuid(),cursor:z.string().uuid().optional()})
const mutationSchema=z.object({propertyId:z.string().uuid(),requestId:z.string().uuid(),authorizationId:z.string().uuid(),expectedVersion:z.number().int().positive(),action:z.enum(['apply','cancel']),accountIds:z.array(z.string().min(1).max(256)).max(100).optional(),reason:z.string().trim().min(3).max(2000)}).strict().refine(v=>v.action!=='apply'||!!v.accountIds?.length)
export async function GET(request:NextRequest){
 try{
  const {data:{user},error}=await(await createClient()).auth.getUser();if(error||!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const search=new URL(request.url).searchParams,p=querySchema.safeParse({propertyId:search.get('propertyId'),cursor:search.get('cursor')??undefined});if(!p.success)return NextResponse.json({error:'Invalid request'},{status:400})
  if(!(await validatePropertyManagerAccess(user.id,p.data.propertyId)).authorized)return NextResponse.json({error:'Manager access is required to review account authorization.'},{status:403})
  const db=createServiceClient()
  let q=db.from('forgestudio_authorizations').select('id,platform,state,result,reason,decision_version,created_at,expires_at,claimed_at,applied_connection_ids').eq('property_id',p.data.propertyId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(31)
  if(p.data.cursor){const {data:anchor,error:anchorError}=await db.from('forgestudio_authorizations').select('id,created_at').eq('property_id',p.data.propertyId).eq('id',p.data.cursor).maybeSingle();if(anchorError)throw new Error('History cursor unavailable');if(!anchor)return NextResponse.json({error:'Authorization history changed. Reload its first page.'},{status:409});q=q.or(`created_at.lt.${anchor.created_at},and(created_at.eq.${anchor.created_at},id.lt.${anchor.id})`)}
  const {data,error:readError}=await q;if(readError)throw new Error('Read unavailable')
  const rows=(data??[]).slice(0,30)
  return NextResponse.json({authorizations:rows.map(row=>{
   const proof=(row.result??{}) as Record<string,unknown>,accounts=Array.isArray(proof.accounts)?proof.accounts as Array<Record<string,unknown>>:[]
   return {id:row.id,platform:row.platform,state:row.state,version:row.decision_version,createdAt:row.created_at,expiresAt:row.expires_at,claimedAt:row.claimed_at,reason:row.reason,connectionIds:row.applied_connection_ids,accounts:accounts.map(a=>({accountId:a.accountId,accountName:a.accountName,accountUsername:a.accountUsername,pageId:a.pageId,scopes:a.scopes,expiresAt:a.expiresAt,expiryKnown:(a.permissionEvidence as Record<string,unknown>|undefined)?.expiryKnown===true}))}
  }),nextCursor:(data?.length??0)>30?rows.at(-1)?.id:null})
 }catch{return NextResponse.json({error:'Saved authorization requests could not be loaded. Reload their history.'},{status:503})}
}
export async function POST(request:NextRequest){
 try{
  const {data:{user},error}=await(await createClient()).auth.getUser();if(error||!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const p=mutationSchema.safeParse(await request.json().catch(()=>null));if(!p.success)return NextResponse.json({error:'Choose the saved authorization, selected accounts and a review reason.'},{status:400})
  const {propertyId,requestId,action,...payload}=p.data;if(!(await validatePropertyManagerAccess(user.id,propertyId)).authorized)return NextResponse.json({error:'Current manager access is required.'},{status:403})
  return NextResponse.json(await socialRpc(action==='apply'?'apply_forgestudio_authorization':'cancel_forgestudio_authorization',{p_id:requestId,p_property_id:propertyId,p_actor_id:user.id,p_payload:payload},['saved','replayed']))
 }catch(error){return NextResponse.json({error:error instanceof ContentStoreError?error.message:'The authorization decision could not be confirmed. Retry the same decision.'},{status:error instanceof ContentStoreError?error.statusCode:503})}
}
