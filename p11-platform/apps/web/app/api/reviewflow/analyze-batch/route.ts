import {after,NextRequest,NextResponse} from 'next/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {requireReviewOperator,loadProfileRole,isManagerRole,reviewError} from '@/utils/reviewflow/access'
import {ReviewStoreError} from '@/utils/reviewflow/analysis-store'
import {batchReadSchema,batchWriteSchema} from '@/utils/reviewflow/batch-contracts'
import {batchRpc,prepareBatch,runReviewAnalysisBatch} from '@/utils/reviewflow/batch-store'
const paused=()=>process.env.OUTBOUND_DELIVERY_PAUSED==='true'
function dispatch(id:string){after(async()=>{try{await runReviewAnalysisBatch(id)}catch{console.error('Saved review analysis queue needs recovery.',{batchId:id})}})}
export const maxDuration=120
export async function GET(request:NextRequest){try{
 const parsed=batchReadSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));if(!parsed.success)throw new ReviewStoreError('Choose a property and saved analysis queue.',400)
 const {propertyId,batchId,cursor,afterPosition}=parsed.data,actor=await requireReviewOperator(propertyId),db=createServiceClient(),role=await loadProfileRole(actor),organization=await db.from('properties').select('org_id').eq('id',propertyId).single();if(organization.error||!organization.data?.org_id)throw new ReviewStoreError('Property unavailable.',403)
 if(batchId){const {data:b,error}=await db.from('reviewflow_analysis_batches').select('id,state,version,summary,selection_count,max_model_calls,model_template,template_hash,approved_by,created_at,approved_at,finished_at').eq('id',batchId).eq('property_id',propertyId).eq('org_id',organization.data.org_id).maybeSingle();if(error)throw error;if(!b)throw new ReviewStoreError('Saved analysis queue unavailable.',404)
  const items=await db.from('reviewflow_analysis_batch_items').select('id,review_id,source_version,source_snapshot,position,state,analysis_request_id,analysis_id,owns_request,error_code').eq('batch_id',batchId).eq('property_id',propertyId).gt('position',afterPosition).order('position').limit(31);if(items.error)throw items.error
  const model=b.model_template as {model:string;promptVersion:string;maxTokens:number};return NextResponse.json({batch:{id:b.id,state:b.state,version:b.version,summary:b.summary,selected:b.selection_count,maxModelCalls:b.max_model_calls,model:{name:model.model,promptVersion:model.promptVersion,maxOutputTokens:model.maxTokens},templateHash:b.template_hash,createdAt:b.created_at,approvedAt:b.approved_at,finishedAt:b.finished_at,items:items.data.slice(0,30).map(i=>{const source=i.source_snapshot as {review_text?:string;reviewer_name?:string;platform?:string;rating?:number};return{id:i.id,reviewId:i.review_id,sourceVersion:i.source_version,position:i.position,state:i.state,analysisRequestId:i.analysis_request_id,analysisId:i.analysis_id,ownsRequest:i.owns_request,errorCode:i.error_code,source:{text:(source.review_text||'').slice(0,20000),reviewerName:source.reviewer_name||'Anonymous',platform:source.platform,rating:source.rating??null}}}),nextPosition:items.data.length>30?items.data[29].position:null},canManage:isManagerRole(role),modelExecutionPaused:paused()})
 }
 let q=db.from('reviewflow_analysis_batches').select('id,state,version,selection_count,summary,created_at,approved_at,finished_at').eq('property_id',propertyId).eq('org_id',organization.data.org_id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(31)
 if(cursor){const a=await db.from('reviewflow_analysis_batches').select('id,created_at').eq('id',cursor).eq('property_id',propertyId).eq('org_id',organization.data.org_id).maybeSingle();if(a.error)throw a.error;if(!a.data)throw new ReviewStoreError('Reload queue history before paging.',409);q=q.or(`created_at.lt.${a.data.created_at},and(created_at.eq.${a.data.created_at},id.lt.${a.data.id})`)}
 const {data,error}=await q;if(error)throw error;return NextResponse.json({batches:data.slice(0,30),nextCursor:data.length>30?data[29].id:null,canManage:isManagerRole(role),modelExecutionPaused:paused()})
}catch(error){return reviewError(error)}}
export async function POST(request:NextRequest){try{
 const parsed=batchWriteSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)throw new ReviewStoreError('Review the saved analysis scope, exact version and reason.',400)
 const {propertyId,requestId,action,...input}=parsed.data,actor=await requireReviewOperator(propertyId);let result:Record<string,unknown>
 if(action==='prepare'&&'scope' in input)result=await prepareBatch(requestId,propertyId,actor,input)
 else if('batchId' in input){if(!isManagerRole(await loadProfileRole(actor)))throw new ReviewStoreError('A manager or admin must approve or control this queue.',403);result=await batchRpc('decide_reviewflow_batch',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:{...input,operation:action}});if(action==='recover')result={...result,...await runReviewAnalysisBatch(input.batchId)};else if(action==='approve'&&!paused())dispatch(input.batchId)}
 else throw new ReviewStoreError('Choose a supported analysis decision.',400)
 return NextResponse.json({result,modelExecutionPaused:paused()})
}catch(error){return reviewError(error)}}
