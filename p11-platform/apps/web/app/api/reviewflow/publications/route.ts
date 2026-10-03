import {NextRequest,NextResponse} from 'next/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {requireReviewOperator,loadProfileRole,isManagerRole,reviewError} from '@/utils/reviewflow/access'
import {ReviewStoreError} from '@/utils/reviewflow/analysis-store'
import {responseContext,responseRpc} from '@/utils/reviewflow/response-store'
import {publicationReadSchema,publicationWriteSchema} from '@/utils/reviewflow/publication-contracts'
export async function GET(request:NextRequest){try{
 const parsed=publicationReadSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));if(!parsed.success)throw new ReviewStoreError('Choose a saved review and property.',400)
 const {propertyId,reviewId,cursor}=parsed.data,actor=await requireReviewOperator(propertyId),db=createServiceClient()
 const [target,context,role]=await Promise.all([responseRpc('reviewflow_publication_target',{p_property_id:propertyId,p_actor_id:actor,p_review_id:reviewId},['ready']),responseContext(propertyId,actor,reviewId),loadProfileRole(actor)])
 let rows=db.from('reviewflow_publications').select('id,response_id,source_version,content_hash,response_text,destination,mode,state,version,report,error_code,created_at,finished_at').eq('property_id',propertyId).eq('review_id',reviewId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(31)
 if(cursor){const anchor=await db.from('reviewflow_publications').select('id,created_at').eq('id',cursor).eq('property_id',propertyId).eq('review_id',reviewId).maybeSingle();if(anchor.error)throw anchor.error;if(!anchor.data)throw new ReviewStoreError('Reload publication history before paging.',409);rows=rows.or(`created_at.lt.${anchor.data.created_at},and(created_at.eq.${anchor.data.created_at},id.lt.${anchor.data.id})`)}
 const [history,approved]=await Promise.all([rows,db.from('review_responses').select('id,version,source_version,context_hash,content_hash,response_text,approved_at').eq('property_id',propertyId).eq('review_id',reviewId).eq('status','approved').is('superseded_at',null).order('created_at',{ascending:false}).limit(31)])
 if(history.error||approved.error)throw new Error('Publication workspace unavailable')
 return NextResponse.json({publications:history.data.slice(0,30),nextCursor:history.data.length>30?history.data[29].id:null,approvedResponses:approved.data.filter(r=>r.source_version&&r.content_hash&&r.context_hash&&r.approved_at).map(r=>({...r,current:r.context_hash===context.contextHash})),target:target.target,targetHash:target.targetHash,hasPreviousPublication:target.hasPreviousPublication,sourceVersion:context.context.review.sourceVersion,canManage:isManagerRole(role),providerExecutionAvailable:false})
}catch(error){return reviewError(error)}}
export async function POST(request:NextRequest){try{
 const parsed=publicationWriteSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)throw new ReviewStoreError('Review the exact response, public destination and outcome evidence.',400)
 const {propertyId,requestId,action,...input}=parsed.data,actor=await requireReviewOperator(propertyId)
 if(!isManagerRole(await loadProfileRole(actor)))throw new ReviewStoreError('A manager or admin must review publication.',403)
 const result=await responseRpc(action==='prepare_manual'?'request_reviewflow_manual_publication':'review_reviewflow_manual_publication',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:action==='prepare_manual'?input:{...input,decision:action==='report_manual'?'reported':action==='cancel_manual'?'not_published':'uncertain'}})
 return NextResponse.json({result})
}catch(error){return reviewError(error)}}
