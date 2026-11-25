import { NextRequest,NextResponse } from 'next/server'
import { hasValidCronAuth } from '@/utils/services/api-helpers'
import { createServiceClient } from '@/utils/supabase/admin'
import { enqueueResearch,processResearchJob } from '@/utils/marketvision/research-store'
import { startCronJobRun,confirmCronJobRun,finishCronJobRun } from '@/utils/services/cron-job-runs'
export const maxDuration=300
export async function GET(request:NextRequest){
  if(!hasValidCronAuth(request))return NextResponse.json({error:'Unauthorized'},{status:401})
  if(process.env.OUTBOUND_DELIVERY_PAUSED==='true')return NextResponse.json({state:'paused'})
  const run=await startCronJobRun({jobName:'process-market-research',requestId:request.headers.get('x-request-id')})
  if(!run)return NextResponse.json({error:'Scheduled research could not be recorded'},{status:503})
  try{
    const due=await createServiceClient().rpc('due_marketvision_research',{p_limit:3})
    if(due.error)throw new Error('Scheduled communities could not be loaded')
    let queued=0;const queueFailures:string[]=[]
    for(const propertyId of due.data || []){try{await enqueueResearch(propertyId,null);queued++}catch{queueFailures.push(propertyId)}}
    const result=await processResearchJob(),failed=result.state==='failed' || queueFailures.length>0
    await confirmCronJobRun(run,{status:failed?'partial':'success',summary:{queued,queueFailures,result}})
    return NextResponse.json({queued,queueFailures,result})
  }catch{await finishCronJobRun(run,{status:'failed',error:'Scheduled market research could not be confirmed'});return NextResponse.json({error:'Scheduled research needs recovery'},{status:503})}
}
