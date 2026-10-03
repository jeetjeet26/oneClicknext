import {NextRequest,NextResponse} from 'next/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {requireReviewOperator,loadProfileRole,isManagerRole,reviewError} from '@/utils/reviewflow/access'
import {ReviewStoreError,reviewRpc} from '@/utils/reviewflow/analysis-store'
import {responseIdSchema as uuid} from '@/utils/reviewflow/response-contracts'
import {testimonialReadSchema,testimonialDecisionSchema} from '@/utils/reviewflow/testimonial-contracts'
type Context={params:Promise<{reviewId:string}>}
const columns='id,review_id,version,status,source_version,content_fingerprint,reviewer_name_snapshot,review_text_snapshot,rating_snapshot,platform_snapshot,review_date_snapshot,attribution_approved,rights_basis,rights_evidence,usage_scope,expires_at,approved_at,revoked_at,revocation_reason'
function resultError(state:unknown){const messages:Record<string,string>={invalid_expiry:'Choose a future permission expiry or leave it empty.',forbidden:'This property is unavailable.',manager_required:'A current manager must review testimonial permissions.',not_found:'This saved review or approval is unavailable.',stale_source:'The review changed. Reload and inspect its exact source before approval.',source_unavailable:'This review is incomplete for testimonial reuse. Inspect the source requirements.',active_approval:'Revoke the existing approval before reviewing replacement rights.',stale_approval:'This permission changed. Reload the saved rights history.',request_conflict:'This decision differs from the saved request. Reload its history.'};return new ReviewStoreError(messages[String(state)]||'The testimonial decision could not be confirmed. Reload its history.',state==='invalid_expiry'?400:state==='forbidden'||state==='manager_required'?403:state==='not_found'?404:409)}
export async function GET(request:NextRequest,{params}:Context){try{
 const review=uuid.safeParse((await params).reviewId),parsed=testimonialReadSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));if(!review.success||!parsed.success)throw new ReviewStoreError('Choose a property and saved review.',400)
 const {propertyId,cursor}=parsed.data,actor=await requireReviewOperator(propertyId),source=await reviewRpc('read_reviewflow_testimonial_source',{p_property_id:propertyId,p_actor_id:actor,p_review_id:review.data});if(source.state!=='ready')throw resultError(source.state)
 const db=createServiceClient();let query=db.from('review_testimonial_approvals').select(columns).eq('property_id',propertyId).eq('review_id',review.data).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(21)
 if(cursor){const a=await db.from('review_testimonial_approvals').select('id,created_at').eq('id',cursor).eq('property_id',propertyId).eq('review_id',review.data).maybeSingle();if(a.error)throw a.error;if(!a.data)throw new ReviewStoreError('Reload rights history before paging.',409);query=query.or(`created_at.lt.${a.data.created_at},and(created_at.eq.${a.data.created_at},id.lt.${a.data.id})`)}
 const {data,error}=await query;if(error)throw error;return NextResponse.json({...source,history:data.slice(0,20),nextCursor:data.length>20?data[19].id:null})
}catch(e){return reviewError(e)}}
async function decide(request:NextRequest,context:Context,expected:'approve'|'revoke'){try{
 const review=uuid.safeParse((await context.params).reviewId),parsed=testimonialDecisionSchema.safeParse(await request.json().catch(()=>null));if(!review.success||!parsed.success||parsed.data.action!==expected)throw new ReviewStoreError('Review the exact source, permission scope and reason before saving.',400)
 const {propertyId,requestId,...input}=parsed.data,actor=await requireReviewOperator(propertyId);if(!isManagerRole(await loadProfileRole(actor)))throw resultError('manager_required');const result=await reviewRpc('decide_reviewflow_testimonial',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:{...input,reviewId:review.data}});if(!['saved','replayed'].includes(String(result.state)))throw resultError(result.state);return NextResponse.json({result})
}catch(e){return reviewError(e)}}
export const POST=(request:NextRequest,context:Context)=>decide(request,context,'approve')
export const DELETE=(request:NextRequest,context:Context)=>decide(request,context,'revoke')
