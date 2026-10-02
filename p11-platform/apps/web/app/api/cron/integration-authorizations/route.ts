import {NextRequest,NextResponse} from 'next/server'
import {validateCronAuth} from '@/utils/services/api-helpers'
import {startCronJobRun,finishCronJobRun} from '@/utils/services/cron-job-runs'
import {expireAuthorizationRequests} from '@/utils/services/integration-authorization'
export const dynamic='force-dynamic'
export async function GET(request:NextRequest){
 const denied=validateCronAuth(request);if(denied)return denied
 const run=await startCronJobRun({jobName:'integration-authorizations',requestId:request.headers.get('x-request-id')})
 if(!run)return NextResponse.json({error:'Authorization cleanup could not be recorded.'},{status:503})
 try {
  const result=await expireAuthorizationRequests()
  const status=result.state==='busy'||result.remaining||result.skipped>0||result.legacyUnqualified>0?'partial':'success'
  if(!await finishCronJobRun(run,{status,summary:result}))return NextResponse.json({error:'Authorization cleanup result is unconfirmed.'},{status:503})
  return NextResponse.json(result)
 }catch{
  await finishCronJobRun(run,{status:'failed',error:'Authorization cleanup is unconfirmed.'})
  return NextResponse.json({error:'Authorization cleanup is unconfirmed.'},{status:503})
 }
}
