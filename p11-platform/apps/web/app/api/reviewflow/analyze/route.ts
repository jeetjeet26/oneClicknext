import {after,NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {responseIdSchema as databaseId} from '@/utils/reviewflow/response-contracts'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {ReviewStoreError,requestReviewAnalysis,reviewRpc,runSavedReviewAnalysis,recoverReviewAnalysis} from '@/utils/reviewflow/analysis-store'
const start=z.object({propertyId:databaseId,requestId:databaseId,reviewId:databaseId,sourceVersion:z.number().int().positive()}).strict()
const control=z.object({propertyId:databaseId,requestId:databaseId,analysisRequestId:databaseId,expectedVersion:z.number().int().positive(),action:z.enum(['stop','recover']),reason:z.string().trim().min(3).max(2000)}).strict()
const querySchema=z.object({propertyId:databaseId,reviewId:databaseId.optional(),cursor:databaseId.optional()})
const paused=()=>process.env.OUTBOUND_DELIVERY_PAUSED==='true'
async function actor(propertyId:string){const {data:{user},error}=await(await createClient()).auth.getUser();if(error||!user)throw new ReviewStoreError('Unauthorized',401);if(!(await validatePropertyAccess(user.id,propertyId)).authorized)throw new ReviewStoreError('Forbidden',403);return user.id}
const failure=(error:unknown)=>NextResponse.json({error:error instanceof ReviewStoreError?error.message:'The analysis result could not be confirmed. Reload its saved history.'},{status:error instanceof ReviewStoreError?error.status:503})
function dispatch(id:string){if(!paused())after(async()=>{try{await runSavedReviewAnalysis(id)}catch{console.error('[reviewflow_analysis] saved request needs recovery',{requestId:id})}})}
export async function POST(request:NextRequest){try{
 const p=start.safeParse(await request.json().catch(()=>null));if(!p.success)return NextResponse.json({error:'Choose a saved review and its current source version. Unsaved text is not sent for analysis.'},{status:400})
 const userId=await actor(p.data.propertyId),result=await requestReviewAnalysis(p.data,userId);if(result.state==='queued')dispatch(String(result.requestId));return NextResponse.json({request:result,modelExecutionPaused:paused()},{status:202})
}catch(error){return failure(error)}}
export async function PATCH(request:NextRequest){try{
 const p=control.safeParse(await request.json().catch(()=>null));if(!p.success)return NextResponse.json({error:'Reload the saved analysis and explain your decision.'},{status:400})
 const {propertyId,requestId,action,...input}=p.data,userId=await actor(propertyId)
 const result=await reviewRpc(action==='stop'?'control_reviewflow_analysis':'request_reviewflow_analysis_recovery',{p_id:requestId,p_property_id:propertyId,p_actor_id:userId,p_input:input},['saved','replayed','stopped','held','completed'])
 if(action==='recover'&&['saved','replayed'].includes(String(result.state))){if(result.requestState==='queued')dispatch(input.analysisRequestId);else return NextResponse.json({request:await recoverReviewAnalysis(input.analysisRequestId,propertyId,userId),modelExecutionPaused:paused()})}
 return NextResponse.json({request:result,modelExecutionPaused:paused()})
}catch(error){return failure(error)}}
export async function GET(request:NextRequest){try{
 const query=new URL(request.url).searchParams,p=querySchema.safeParse({propertyId:query.get('propertyId'),reviewId:query.get('reviewId')??undefined,cursor:query.get('cursor')??undefined});if(!p.success)return NextResponse.json({error:'Invalid analysis history request'},{status:400});await actor(p.data.propertyId)
 const db=createServiceClient();let currentSourceVersion:number|null=null
 if(p.data.reviewId){const {data,error}=await db.from('reviews').select('source_version').eq('id',p.data.reviewId).eq('property_id',p.data.propertyId).maybeSingle();if(error)throw new ReviewStoreError('Current review could not be loaded.');if(!data)throw new ReviewStoreError('Review unavailable.',404);currentSourceVersion=data.source_version}
 let q=db.from('reviewflow_analysis_requests').select('id,review_id,source_version,state,version,analysis_id,error_code,created_at,started_at,finished_at').eq('property_id',p.data.propertyId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(31);if(p.data.reviewId)q=q.eq('review_id',p.data.reviewId)
 if(p.data.cursor){let a=db.from('reviewflow_analysis_requests').select('id,created_at').eq('property_id',p.data.propertyId).eq('id',p.data.cursor);if(p.data.reviewId)a=a.eq('review_id',p.data.reviewId);const {data:anchor,error}=await a.maybeSingle();if(error)throw new ReviewStoreError('History cursor could not be loaded.');if(!anchor)throw new ReviewStoreError('Analysis history changed. Reload its first page.',409);q=q.or(`created_at.lt.${anchor.created_at},and(created_at.eq.${anchor.created_at},id.lt.${anchor.id})`)}
 const {data,error}=await q;if(error)throw new ReviewStoreError('Analysis history could not be loaded.');const rows=(data??[]).slice(0,30);return NextResponse.json({requests:rows,nextCursor:(data?.length??0)>30?rows.at(-1)?.id:null,currentSourceVersion,modelExecutionPaused:paused()})
}catch(error){return failure(error)}}
