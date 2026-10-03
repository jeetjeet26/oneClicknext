import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {actionHistoryDb} from '@/utils/actions/history'
import {activityActorLabel} from '@/utils/actions/presentation'
import {pageObservation,PRODUCT_LABELS} from '@/utils/actions/catalog'

async function authorize(propertyId:string) {
 const auth=await createClient(),{data:{user},error}=await auth.auth.getUser()
 if(error||!user)return {response:NextResponse.json({error:'Unauthorized'},{status:401})}
 const access=await validatePropertyAccess(user.id,propertyId)
 if(!access.authorized)return {response:NextResponse.json({error:'Forbidden'},{status:403})}
 return {user,orgId:access.orgId,db:actionHistoryDb(createServiceClient())}
}
const databaseId=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const observation=z.object({id:z.string().uuid(),episodeId:z.string().uuid(),propertyId:databaseId,expectedActorId:databaseId,path:z.string().max(100)}).strict()
export async function POST(request:NextRequest) {
 try {
  const body=observation.safeParse(await request.json().catch(()=>null))
  if(!body.success)return NextResponse.json({error:'Invalid page observation'},{status:400})
  const v=body.data,page=pageObservation(v.path)
  if(!page||page.path!==v.path)return NextResponse.json({error:'Unknown page'},{status:400})
  const access=await authorize(v.propertyId);if(access.response)return access.response
  if(access.user!.id!==v.expectedActorId)return NextResponse.json({error:'Session changed; observation was not recorded'},{status:409})
  const saved=await access.db!.rpc('append_shared_action_event',{p_id:v.id,p_episode_id:v.episodeId,p_property_id:v.propertyId,p_actor_id:access.user!.id,p_product:page.product,p_action:'console.page.viewed',p_evidence:'browser_observed',p_phase:'observed',p_request:{path:page.path},p_before:null,p_after:null,p_result:{observed:true}})
  if(saved.error||!saved.data)throw new Error('Recording acknowledgement lost')
  const result=saved.data as {state:string;eventId?:string}
  if(!['recorded','replayed'].includes(result.state))return NextResponse.json({error:'This observation identity conflicts with an existing record'},{status:409})
  return NextResponse.json(result)
 }catch{return NextResponse.json({error:'The activity record is unconfirmed. Retry the same observation.'},{status:503})}
}
const filters=z.object({propertyId:databaseId,product:z.string().refine(v=>v in PRODUCT_LABELS).optional(),evidence:z.enum(['browser_observed','server_confirmed']).optional(),before:z.string().datetime({offset:true}).optional(),beforeId:z.string().uuid().optional()}).refine(v=>!!v.before===!!v.beforeId)
export async function GET(request:NextRequest) {
 try {
  const parsed=filters.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if(!parsed.success)return NextResponse.json({error:'Invalid activity filters'},{status:400})
  const f=parsed.data,access=await authorize(f.propertyId);if(access.response)return access.response
  let q=access.db!.from('shared_action_events').select('id,episode_id,actor_id,service_principal,product,action,evidence,phase,request,before_state,after_state,result,created_at,shared_job_ref,shared_attempt_ref,context_snapshot_ref').eq('property_id',f.propertyId).eq('org_id',access.orgId!)
  if(f.product)q=q.eq('product',f.product)
  if(f.evidence)q=q.eq('evidence',f.evidence)
  if(f.before)q=q.or(`created_at.lt.${f.before},and(created_at.eq.${f.before},id.lt.${f.beforeId})`)
  const {data,error}=await q.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(51)
  if(error)throw error
  const events=(data||[]).slice(0,50),last=events.at(-1)
  return NextResponse.json({events:events.map(e=>({...e,result:e.product==='integrations'&&e.phase==='failed'&&e.result&&typeof e.result==='object'&&!Array.isArray(e.result)&&typeof e.result.state==='string'?{state:e.result.state}:undefined,actor:activityActorLabel(e,access.user!.id),actor_id:undefined})),nextCursor:(data?.length||0)>50&&last?{before:last.created_at,beforeId:last.id}:null,coverage:'This history includes recorded decisions and system results across products. Page visits are observations; delivery and business outcomes require their own evidence. Interrupted observations, older records and unqualified integrations may be incomplete.'})
 }catch{return NextResponse.json({error:'Activity history could not be loaded. Try again.'},{status:500})}
}
