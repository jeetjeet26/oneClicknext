import {randomUUID} from 'node:crypto'
import {NextRequest,NextResponse} from 'next/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {hasValidCronAuth} from '@/utils/services/api-helpers'
import {startCronJobRun,finishCronJobRun} from '@/utils/services/cron-job-runs'
import {requestIntake,runSavedIntake} from '@/utils/reviewflow/intake-store'
export async function GET(request:NextRequest){
 if(!hasValidCronAuth(request))return NextResponse.json({error:'Unauthorized'},{status:401})
 if(process.env.OUTBOUND_DELIVERY_PAUSED==='true')return NextResponse.json({state:'paused',fetched:0,applied:0})
 const run=await startCronJobRun({jobName:'sync-reviews',requestId:request.headers.get('x-request-id')})
 if(!run)return NextResponse.json({error:'The review source check could not be recorded.'},{status:503})
 try{
  const {data,error}=await createServiceClient().rpc('list_reviewflow_due_sources',{p_limit:20});if(error)throw error
  const sources=data as unknown as Array<{id:string;property_id:string;version:number;schedule_key:string}>,results:Array<{connectionId:string;requestId?:string;state:string}>=[]
  for(const source of sources){try{const saved=await requestIntake(randomUUID(),source.property_id,null,{kind:'source',trigger:'schedule',connectionId:source.id,connectionVersion:source.version,scheduleKey:source.schedule_key,reason:'Scheduled source check under reviewed connection settings.'});const requestId=String(saved.requestId),outcome=saved.state==='queued'?await runSavedIntake(requestId):saved;results.push({connectionId:source.id,requestId,state:String(outcome.state)})}catch{results.push({connectionId:source.id,state:'needs_review'})}}
  const failures=results.filter(r=>['held','needs_review'].includes(r.state)).length,summary={checked:results.length,previewReady:results.filter(r=>r.state==='preview').length,failed:failures,applied:0},status=failures?(failures===results.length?'failed':'partial'):'success'
  const recorded=await finishCronJobRun(run,{status,summary,error:failures?'One or more saved review checks need review.':null});if(!recorded)return NextResponse.json({error:'The scheduler result is unconfirmed. Inspect saved source requests before recovery.'},{status:503});return NextResponse.json({status,...summary,results})
 }catch{await finishCronJobRun(run,{status:'failed',summary:{applied:0},error:'Saved review source checks could not be confirmed.'});return NextResponse.json({error:'Saved source checks could not be confirmed. Inspect import history before retrying.'},{status:503})}
}
