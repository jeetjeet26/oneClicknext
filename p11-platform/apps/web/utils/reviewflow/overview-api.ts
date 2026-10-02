import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {requireReviewOperator,reviewError} from '@/utils/reviewflow/access'
import {responseIdSchema as uuid} from '@/utils/reviewflow/response-contracts'
import {reviewRpc,ReviewStoreError} from '@/utils/reviewflow/analysis-store'
const stats=z.object({propertyId:uuid,days:z.coerce.number().int().min(0).max(365).default(0)}).strict()
const queue=z.object({propertyId:uuid,bucket:z.enum(['high_risk','sla_risk','awaiting_approval','ready_to_post','remediation','needs_attention','completed']).optional(),cursor:uuid.optional()}).strict().refine(v=>!v.cursor||!!v.bucket)
const recovery=z.object({propertyId:uuid,cursor:z.string().regex(/^[a-z_]+:[a-f0-9-]{36}$/i).optional()}).strict()
export async function readOverview(request:NextRequest,kind:'stats'|'queue'|'recovery'){
 try{
  const parsed=(kind==='stats'?stats:kind==='queue'?queue:recovery).safeParse(Object.fromEntries(request.nextUrl.searchParams));if(!parsed.success)throw new ReviewStoreError('Choose a property and valid saved-work filters.',400)
  const {propertyId,...input}=parsed.data,actor=await requireReviewOperator(propertyId),args={p_property_id:propertyId,p_actor_id:actor,...(kind==='stats'?{p_days:'days' in input?input.days:0}:kind==='queue'?{p_bucket:'bucket' in input?input.bucket??null:null,p_cursor:'cursor' in input?input.cursor??null:null}:{p_cursor:'cursor' in input?input.cursor??null:null})}
  const r=await reviewRpc(kind==='stats'?'read_reviewflow_statistics':kind==='queue'?'read_reviewflow_queue':'read_reviewflow_recovery',args)
  if(r.state==='forbidden')throw new ReviewStoreError('This property is unavailable.',403)
  if(r.state==='stale_cursor')throw new ReviewStoreError('The saved workload changed. Reload this queue before paging.',409)
  if(r.state!=='ready')throw new ReviewStoreError('The complete saved workload could not be confirmed. Reload and try again.')
  return NextResponse.json(r)
 }catch(e){return reviewError(e)}
}
