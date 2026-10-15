import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { hasValidCronAuth } from '@/utils/services/api-helpers'
import { brainRpc } from '@/utils/community-brain/server'
import { cleanupProviderObjects } from '@/utils/community-brain/providers'
import { startCronJobRun, confirmCronJobRun, finishCronJobRun } from '@/utils/services/cron-job-runs'
export const maxDuration=300
export async function GET(request:NextRequest){
 if(!hasValidCronAuth(request))return NextResponse.json({error:'Unauthorized'},{status:401})
 const run=await startCronJobRun({jobName:'community-brain-maintenance',requestId:request.headers.get('x-request-id')})
 if(!run)return NextResponse.json({error:'Maintenance could not be recorded.'},{status:503})
 try{
  const local=await brainRpc<Record<string,unknown>>('brain_run_maintenance',{})
  const provider=process.env.OPENAI_API_KEY&&process.env.OPENAI_PROJECT_ID?await cleanupProviderObjects(new OpenAI({maxRetries:0,timeout:5000})):[]
  const pending=provider.filter(r=>!r.confirmed).length
  const summary={...local,providerCleanupConfigured:!!process.env.OPENAI_API_KEY&&!!process.env.OPENAI_PROJECT_ID,providerObjectsChecked:provider.length,providerDeletionsConfirmed:provider.length-pending,providerDeletionsUnconfirmed:pending}
  await confirmCronJobRun(run,{status:pending?'partial':'success',summary,error:pending?'Some provider deletions need reconciliation.':null})
  return NextResponse.json(summary,{headers:{'Cache-Control':'private, no-store'}})
 }catch{
  await finishCronJobRun(run,{status:'failed',error:'Community maintenance requires review; unconfirmed deletion is not completion.'})
  return NextResponse.json({error:'Maintenance requires review.'},{status:503})
 }
}
