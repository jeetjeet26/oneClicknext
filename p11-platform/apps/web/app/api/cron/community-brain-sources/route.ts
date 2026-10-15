import {NextRequest,NextResponse} from 'next/server'
import {hasValidCronAuth} from '@/utils/services/api-helpers'
import {brainRpc} from '@/utils/community-brain/server'
import {syncConnectedFiles} from '@/utils/community-brain/connected-files'
import {startCronJobRun,confirmCronJobRun,finishCronJobRun} from '@/utils/services/cron-job-runs'
export const maxDuration=300
export async function GET(request:NextRequest){
 if(!hasValidCronAuth(request))return NextResponse.json({error:'Unauthorized'},{status:401})
 const run=await startCronJobRun({jobName:'community-brain-sources',requestId:request.headers.get('x-request-id')})
 if(!run)return NextResponse.json({error:'Source checks could not be recorded.'},{status:503})
 try{
  const due=await brainRpc<Array<{sourceId:string;propertyId:string;actorId:string;leaseToken:string}>>('brain_due_connected_sources',{p_limit:2})
  const outcomes=await Promise.allSettled(due.map(async item=>{
   let state:'succeeded'|'partial'|'failed'='failed'
   try{const result=await syncConnectedFiles(item.actorId,item.propertyId,item.sourceId);state=result.status==='succeeded'?'succeeded':'partial'}
   finally{await brainRpc('brain_finish_source_schedule',{p_source_id:item.sourceId,p_lease_token:item.leaseToken,p_state:state})}
   return state
  }))
  const failed=outcomes.filter(r=>r.status==='rejected').length,partial=outcomes.filter(r=>r.status==='fulfilled'&&r.value==='partial').length
  const summary={checked:due.length,failed,partial,automaticallyApproved:0}
  await confirmCronJobRun(run,{status:failed||partial?'partial':'success',summary,error:failed?'Some connected sources need review.':null})
  return NextResponse.json(summary)
 }catch{
  await finishCronJobRun(run,{status:'failed',error:'Scheduled source checking requires review.'})
  return NextResponse.json({error:'Source checks require review.'},{status:503})
 }
}
