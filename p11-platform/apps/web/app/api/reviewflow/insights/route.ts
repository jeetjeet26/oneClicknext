import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {requireReviewOperator,reviewError} from '@/utils/reviewflow/access'
import {createServiceClient} from '@/utils/supabase/admin'
import {ReviewStoreError} from '@/utils/reviewflow/analysis-store'
import {responseIdSchema as uuid} from '@/utils/reviewflow/response-contracts'
import {readInsightPreview,saveInsightReport} from '@/utils/reviewflow/insights-store'
const read=z.object({propertyId:uuid,days:z.coerce.number().int().min(7).max(365).default(90),reportId:uuid.optional(),history:z.literal('true').optional(),cursor:uuid.optional()}).strict().refine(v=>!(v.reportId&&(v.history||v.cursor))&&(!v.cursor||v.history==='true'),'Choose either current insights, a saved report or report history.')
const write=z.object({propertyId:uuid,requestId:uuid,windowDays:z.number().int().min(7).max(365),asOf:z.iso.datetime({offset:true}),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().trim().min(3).max(2000)}).strict()
export async function GET(request:NextRequest){try{
 const parsed=read.safeParse(Object.fromEntries(request.nextUrl.searchParams));if(!parsed.success)throw new ReviewStoreError('Choose a property and an insight window of 7–365 days.',400)
 const {propertyId,days,reportId,history,cursor}=parsed.data,actor=await requireReviewOperator(propertyId)
 if(!reportId&&!history)return NextResponse.json(await readInsightPreview(propertyId,actor,days))
 const db=createServiceClient(),org=await db.from('properties').select('org_id').eq('id',propertyId).single();if(org.error||!org.data?.org_id)throw new ReviewStoreError('Property unavailable.',403)
 if(reportId){const r=await db.from('reviewflow_insight_reports').select('id,input,result,created_at').eq('id',reportId).eq('property_id',propertyId).eq('org_id',org.data.org_id).maybeSingle();if(r.error)throw r.error;if(!r.data)throw new ReviewStoreError('Saved report unavailable.',404);return NextResponse.json({report:r.data})}
 let q=db.from('reviewflow_insight_reports').select('id,input,created_at').eq('property_id',propertyId).eq('org_id',org.data.org_id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(31)
 if(cursor){const a=await db.from('reviewflow_insight_reports').select('id,created_at').eq('id',cursor).eq('property_id',propertyId).eq('org_id',org.data.org_id).maybeSingle();if(a.error)throw a.error;if(!a.data)throw new ReviewStoreError('Reload report history before paging.',409);q=q.or(`created_at.lt.${a.data.created_at},and(created_at.eq.${a.data.created_at},id.lt.${a.data.id})`)}
 const r=await q;if(r.error)throw r.error;return NextResponse.json({reports:r.data.slice(0,30),nextCursor:r.data.length>30?r.data[29].id:null})
}catch(e){return reviewError(e)}}
export async function POST(request:NextRequest){try{const parsed=write.safeParse(await request.json().catch(()=>null));if(!parsed.success)throw new ReviewStoreError('Review the exact insight report, source and reason.',400);const {propertyId,requestId,...input}=parsed.data,actor=await requireReviewOperator(propertyId);return NextResponse.json({result:await saveInsightReport(requestId,propertyId,actor,input)})}catch(e){return reviewError(e)}}
