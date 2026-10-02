import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyAccess,validatePropertyManagerAccess} from '@/utils/services/auth-guard'
import {socialRpc,socialCredentialStorageReady} from '@/utils/forgestudio/social-security'
import {ContentStoreError} from '@/utils/forgestudio/content-store'
const querySchema=z.object({propertyId:z.string().uuid(),cursor:z.string().uuid().optional()})
const mutationSchema=z.object({propertyId:z.string().uuid(),requestId:z.string().uuid(),connectionId:z.string().uuid(),expectedVersion:z.number().int().positive(),reason:z.string().trim().min(3).max(2000)}).strict()
export async function GET(request:NextRequest){
 try{
  const {data:{user},error}=await(await createClient()).auth.getUser();if(error||!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const search=new URL(request.url).searchParams,p=querySchema.safeParse({propertyId:search.get('propertyId'),cursor:search.get('cursor')??undefined});if(!p.success)return NextResponse.json({error:'Invalid request'},{status:400})
  if(!(await validatePropertyAccess(user.id,p.data.propertyId)).authorized)return NextResponse.json({error:'Forbidden'},{status:403})
  let q=createServiceClient().from('social_connections').select('id,platform,account_id,account_name,account_username,is_active,scopes,token_expires_at,last_used_at,created_at,security_version,disconnected_at,permission_evidence,refresh_token,refresh_token_expires_at').eq('property_id',p.data.propertyId).order('id',{ascending:true}).limit(31)
  if(p.data.cursor)q=q.gt('id',p.data.cursor)
  const {data,error:readError}=await q;if(readError)throw new Error('Read unavailable')
  const rows=(data??[]).slice(0,30)
  const current=new Map<string,{state:string;reason:string|null;created_at:string}>()
  if(rows.length){const {data:renewals,error:renewalError}=await createServiceClient().from('forgestudio_renewals').select('connection_id,connection_version,state,reason,created_at').eq('property_id',p.data.propertyId).or(rows.map(row=>`and(connection_id.eq.${row.id},connection_version.eq.${row.security_version})`).join(','));if(renewalError)throw new Error('Renewal state unavailable');for(const renewal of renewals??[])current.set(renewal.connection_id,renewal)}
  return NextResponse.json({connections:rows.map(({refresh_token,...row})=>{
   const proof=row.permission_evidence as Record<string,unknown>|null,renewal=current.get(row.id)
   return {...row,permission_evidence:proof?{source:proof.source,observedAt:proof.observedAt,expiryKnown:proof.expiryKnown}:null,needs_refresh:!row.token_expires_at||new Date(row.token_expires_at).getTime()<Date.now()+7*86400000,can_renew:row.is_active===true&&!row.disconnected_at&&proof?.source==='provider_response'&&typeof proof.authorizationId==='string'&&!renewal&&(row.platform==='facebook'||row.platform==='instagram'?!!row.token_expires_at&&Date.parse(row.token_expires_at)>Date.now():!!refresh_token&&(!row.refresh_token_expires_at||Date.parse(row.refresh_token_expires_at)>Date.now())),renewal_state:renewal?.state??null,renewal_reason:renewal?.reason??null,renewal_started_at:renewal?.created_at??null}
  }),nextCursor:(data?.length??0)>30?rows.at(-1)?.id:null,authorizationPaused:process.env.OUTBOUND_DELIVERY_PAUSED==='true',credentialStorageAvailable:socialCredentialStorageReady()})
 }catch{return NextResponse.json({error:'Connected accounts could not be loaded. Reload their saved status.'},{status:503})}
}
export async function DELETE(request:NextRequest){
 try{
  const {data:{user},error}=await(await createClient()).auth.getUser();if(error||!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const p=mutationSchema.safeParse(await request.json().catch(()=>null));if(!p.success)return NextResponse.json({error:'Reload accounts before making a versioned disconnect decision.'},{status:400})
  const {propertyId,requestId,...payload}=p.data;if(!(await validatePropertyManagerAccess(user.id,propertyId)).authorized)return NextResponse.json({error:'Disconnecting an account requires current manager access.'},{status:403})
  return NextResponse.json(await socialRpc('disconnect_forgestudio_connection',{p_id:requestId,p_property_id:propertyId,p_actor_id:user.id,p_payload:payload},['saved','replayed']))
 }catch(error){return NextResponse.json({error:error instanceof ContentStoreError?error.message:'The disconnect result could not be confirmed. Retry the same decision.'},{status:error instanceof ContentStoreError?error.statusCode:503})}
}
