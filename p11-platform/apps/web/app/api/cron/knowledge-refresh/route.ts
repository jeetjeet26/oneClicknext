import {NextRequest,NextResponse} from 'next/server'
import {hasValidCronAuth} from '@/utils/services/api-helpers'
import {startCronJobRun,confirmCronJobRun,finishCronJobRun} from '@/utils/services/cron-job-runs'
import {checkScheduledWebsites} from '@/utils/knowledge/web-policy-store'
import {POST as reviewedWebsiteGuidance} from '../../community/scrape-website/route'
export const POST=reviewedWebsiteGuidance
export const maxDuration=300
const headers={'Cache-Control':'private, no-store'}
export async function GET(request:NextRequest){
 if(!hasValidCronAuth(request))return NextResponse.json({error:'Unauthorized'},{status:401,headers})
 const run=await startCronJobRun({jobName:'knowledge-refresh',requestId:request.headers.get('x-request-id')})
 if(!run)return NextResponse.json({error:'Website checks could not be recorded.'},{status:503,headers})
 try{
  const result=await checkScheduledWebsites()
  const status=result.state==='review_required'?(result.ready?'partial':'failed'):'success'
  await confirmCronJobRun(run,{status,summary:{...result,published:0},error:status==='success'?null:'Some private captures need review or recovery.'})
  return NextResponse.json({...result,published:0},{headers})
 }catch{
  await finishCronJobRun(run,{status:'failed',error:'Website check outcomes could not be confirmed. Read retained requests before recovery.'})
  return NextResponse.json({error:'Website check outcomes could not be confirmed. No automatic publication is performed.'},{status:503,headers})
 }
}
