import {NextRequest,NextResponse} from 'next/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {hasValidCronAuth} from '@/utils/services/api-helpers'
import {startCronJobRun,confirmCronJobRun,finishCronJobRun} from '@/utils/services/cron-job-runs'
import {recoverExtraction,extractionExecutionStatus} from '@/utils/marketvision/extraction-store'
export const maxDuration=180
export async function GET(req:NextRequest){if(!hasValidCronAuth(req))return NextResponse.json({error:'Unauthorized'},{status:401});const readiness=extractionExecutionStatus();if(readiness.paused||!readiness.configured)return NextResponse.json({state:readiness.paused?'paused':'provider_unavailable',processed:0});const run=await startCronJobRun({jobName:'process-market-extractions',requestId:req.headers.get('x-request-id')});if(!run)return NextResponse.json({error:'Could not record scheduled extraction processing.'},{status:503});try{
 const {data,error}=await createServiceClient().from('marketvision_extraction_requests').select('id').in('state',['queued','result_ready']).order('created_at',{ascending:true}).limit(2);if(error)throw error;
 const results:Array<{requestId:string;state:string}>=[];for(const item of data){try{const result=await recoverExtraction(item.id);results.push({requestId:item.id,state:String('requestState' in result ? result.requestState : result.state)})}catch{results.push({requestId:item.id,state:'unconfirmed'})}}
 const failed=results.filter(r=>['held','unconfirmed'].includes(r.state)).length,status=failed?(failed===results.length?'failed':'partial'):'success';await confirmCronJobRun(run,{status,summary:{processed:results.length,needsReview:failed}});return NextResponse.json({status,processed:results.length,results})
}catch{await finishCronJobRun(run,{status:'failed',error:'Saved extraction work could not be confirmed.'});return NextResponse.json({error:'Saved extraction work could not be confirmed. Inspect request history.'},{status:503})}}
