import {after,NextRequest,NextResponse} from 'next/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {requireReviewOperator,loadProfileRole,isManagerRole,reviewError} from '@/utils/reviewflow/access'
import {ReviewStoreError} from '@/utils/reviewflow/analysis-store'
import {intakeWriteSchema,intakeReadSchema} from '@/utils/reviewflow/intake-contracts'
import {requestIntake,recoverIntake,runSavedIntake,intakeRpc} from '@/utils/reviewflow/intake-store'
import type {IntakeRow} from '@/utils/reviewflow/intake-parser'
const paused=()=>process.env.OUTBOUND_DELIVERY_PAUSED==='true'
function dispatch(id:string){after(async()=>{try{await runSavedIntake(id)}catch{console.error('Saved review import needs result recovery.',{requestId:id})}})}
export async function GET(request:NextRequest){try{
 const parsed=intakeReadSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));if(!parsed.success)throw new ReviewStoreError('Choose a property and saved import.',400)
 const {propertyId,intakeId,cursor,offset}=parsed.data,actor=await requireReviewOperator(propertyId),db=createServiceClient(),role=await loadProfileRole(actor)
 const organization=await db.from('properties').select('org_id').eq('id',propertyId).single();if(organization.error||!organization.data?.org_id)throw new ReviewStoreError('This property is unavailable.',403)
 if(intakeId){const {data:r,error}=await db.from('reviewflow_intake_requests').select('id,kind,trigger_kind,state,version,source_snapshot,normalized,preview,error_code,error_detail,summary,created_at,started_at,finished_at,parent_request_id').eq('id',intakeId).eq('property_id',propertyId).eq('org_id',organization.data.org_id).maybeSingle();if(error)throw error;if(!r)throw new ReviewStoreError('Saved import unavailable.',404)
  const normalized=r.normalized as unknown as {reviews:IntakeRow[];duplicateRows:number;retrievalMethod:string;completeness:string;note:string|null}|null,preview=r.preview as unknown as Array<{reviewId:string|null;sourceVersion:number|null;changeKind:string}>|null
  const rows=(normalized?.reviews||[]).slice(offset,offset+30).map((item,i)=>({index:offset+i+1,...item,...preview?.[offset+i]})),snapshot=r.source_snapshot as {platform?:string;providerId?:string}|null
  return NextResponse.json({intake:{id:r.id,kind:r.kind,trigger:r.trigger_kind,state:r.state,version:r.version,errorCode:r.error_code,errorDetail:r.error_detail,summary:r.summary,createdAt:r.created_at,startedAt:r.started_at,finishedAt:r.finished_at,parentId:r.parent_request_id,source:snapshot?{platform:snapshot.platform,providerId:snapshot.providerId}:null,rows,total:normalized?.reviews.length||0,nextOffset:(normalized?.reviews.length||0)>offset+30?offset+30:null,duplicates:normalized?.duplicateRows||0,retrievalMethod:normalized?.retrievalMethod,completeness:normalized?.completeness,note:normalized?.note},canManage:isManagerRole(role),externalExecutionPaused:paused()})
 }
 let q=db.from('reviewflow_intake_requests').select('id,kind,trigger_kind,state,version,error_code,error_detail,summary,created_at,finished_at,connection_id').eq('property_id',propertyId).eq('org_id',organization.data.org_id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(31)
 if(cursor){const anchor=await db.from('reviewflow_intake_requests').select('id,created_at').eq('id',cursor).eq('property_id',propertyId).eq('org_id',organization.data.org_id).maybeSingle();if(anchor.error)throw anchor.error;if(!anchor.data)throw new ReviewStoreError('Reload import history before paging.',409);q=q.or(`created_at.lt.${anchor.data.created_at},and(created_at.eq.${anchor.data.created_at},id.lt.${anchor.data.id})`)}
 const {data,error}=await q;if(error)throw error;return NextResponse.json({imports:data.slice(0,30),nextCursor:data.length>30?data[29].id:null,canManage:isManagerRole(role),externalExecutionPaused:paused()})
}catch(error){return reviewError(error)}}
export async function POST(request:NextRequest){try{
 if(Number(request.headers.get('content-length')||0)>2_200_000)throw new ReviewStoreError('Split imports into files of at most 2 MB.',413)
 const parsed=intakeWriteSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)throw new ReviewStoreError('Review the source, saved version and reason for this import decision.',400)
 const {propertyId,requestId,action,...input}=parsed.data,actor=await requireReviewOperator(propertyId);let result:Record<string,unknown>
 if(action==='save'&&'content' in input){result=await requestIntake(requestId,propertyId,actor,{...input,trigger:'operator'});if(result.state==='result_ready')result=await recoverIntake(String(result.requestId),propertyId)}
 else if(action==='fetch'&&'connectionId' in input){if(!isManagerRole(await loadProfileRole(actor)))throw new ReviewStoreError('A manager or admin must request source checks.',403);result=await requestIntake(requestId,propertyId,actor,{...input,kind:'source',trigger:'operator'});if(result.state==='queued'&&!paused())dispatch(String(result.requestId))}
 else if('intakeId' in input){result=await intakeRpc(action==='apply'?'apply_reviewflow_intake':'control_reviewflow_intake',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:{...input,...(action==='apply'?{}:{operation:action})}})
  if(action==='recover'||action==='rebase'){result={...result,...await recoverIntake(String(result.requestId||input.intakeId),propertyId)};if(result.state==='queued'&&!paused())dispatch(String(result.requestId))}
 }else throw new ReviewStoreError('Choose a supported import action.',400)
 return NextResponse.json({result,externalExecutionPaused:paused()},{status:result.state==='queued'?202:200})
}catch(error){return reviewError(error)}}
