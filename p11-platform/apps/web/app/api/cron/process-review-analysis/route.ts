import {NextRequest,NextResponse} from 'next/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {hasValidCronAuth} from '@/utils/services/api-helpers'
import {startCronJobRun,finishCronJobRun} from '@/utils/services/cron-job-runs'
import {runReviewAnalysisBatch} from '@/utils/reviewflow/batch-store'
export const maxDuration=120
export async function GET(request:NextRequest){
 if(!hasValidCronAuth(request))return NextResponse.json({error:'Unauthorized'},{status:401})
 if(process.env.OUTBOUND_DELIVERY_PAUSED==='true')return NextResponse.json({state:'paused',processed:0})
 const run=await startCronJobRun({jobName:'process-review-analysis',requestId:request.headers.get('x-request-id')})
 try{
  const {data,error}=await createServiceClient().rpc('list_reviewflow_batch_work',{p_limit:5});if(error)throw error
  const results:Array<{batchId:string;state:string}>=[],started=Date.now()
  for(const batchId of data as unknown as string[]){if(Date.now()-started>20000)break;try{const outcome=await runReviewAnalysisBatch(batchId);results.push({batchId,state:String(outcome.state)})}catch{results.push({batchId,state:'unconfirmed'})}}
  const failed=results.filter(r=>['needs_review','unconfirmed'].includes(r.state)).length,status=failed?(failed===results.length?'failed':'partial'):'success',summary={processed:results.length,completed:results.filter(r=>r.state==='completed').length,needsReview:failed}
  await finishCronJobRun(run,{status,summary,error:failed?'Saved review analysis work requires review.':null});return NextResponse.json({status,...summary,results})
 }catch{await finishCronJobRun(run,{status:'failed',summary:{processed:0},error:'Review analysis queues could not be confirmed.'});return NextResponse.json({error:'Review analysis queues could not be confirmed. Inspect saved queue history.'},{status:503})}
}
