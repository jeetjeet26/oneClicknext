import { validateCronAuth } from '@/utils/services/api-helpers'
import { confirmCronJobRun,finishCronJobRun,startCronJobRun } from '@/utils/services/cron-job-runs'
import { phaseFourDb } from '@/utils/services/phase-four-db'
import { getDataEngineUrl } from '@/utils/services/runtime-config'
import { createServiceClient } from '@/utils/supabase/admin'
import { NextRequest,NextResponse } from 'next/server'
export const maxDuration = 300

export async function GET(req:NextRequest) {
  const denied=validateCronAuth(req)
  if(denied) return denied
  if(process.env.OUTBOUND_DELIVERY_PAUSED==='true')return NextResponse.json({state:'paused',processed:0})
  const run=await startCronJobRun({jobName:'scrape-competitors',requestId:req.headers.get('x-request-id')})
  if(!run) return NextResponse.json({error:'Could not record scheduled refresh'},{status:503})
  try {
    const key=process.env.DATA_ENGINE_API_KEY
    if(!key) throw new Error('Scraping service authentication is not configured')
    const db=phaseFourDb(createServiceClient())
    const claimed=await db.rpc('claim_phase_four_maintenance',{p_kind:'competitors',p_limit:5})
    if(claimed.error || !claimed.data) throw new Error('Could not confirm scheduled refresh claims')
    const configs=claimed.data as unknown as Array<{property_id:string;maintenanceId:string;maintenanceToken:string}>
    const outcomes=[]
    for(const config of configs) {
      let success=false
      let updated=0
      try {
        const response=await fetch(`${getDataEngineUrl()}/scraper/refresh-pricing`,{method:'POST',
          headers:{'Content-Type':'application/json','X-API-Key':key},
          body:JSON.stringify({property_id:config.property_id,prefer_website:true}),signal:AbortSignal.timeout(50000)})
        const payload=await response.json()
        success=response.ok && payload.success===true && Number.isInteger(payload.updated_count) &&
          payload.error_count===0 && Number.isInteger(payload.total_competitors) && payload.updated_count===payload.total_competitors
        updated=Number.isInteger(payload.updated_count) ? payload.updated_count : 0
      } catch { /* A missing receipt is a failure, not a completed refresh. */ }
      const saved=await db.rpc('finish_phase_four_maintenance',{p_kind:'competitors',p_item_id:config.maintenanceId,p_token:config.maintenanceToken,p_success:success})
      if(saved.error || !saved.data) throw new Error('Could not confirm scheduled refresh result')
      outcomes.push({propertyId:config.property_id,success,updated})
    }
    const succeeded=outcomes.filter(o=>o.success).length
    const failed=outcomes.length-succeeded
    const status=failed ? (succeeded ? 'partial' : 'failed') : 'success'
    await confirmCronJobRun(run,{status,summary:{scheduled:configs.length,succeeded,failed,outcomes}})
    return NextResponse.json({success:!failed,status,processed:outcomes.length,succeeded,failed,outcomes},{status:status==='failed'?502:200})
  } catch {
    await finishCronJobRun(run,{status:'failed',error:'Scheduled competitor refresh could not be confirmed'})
    return NextResponse.json({success:false,error:'Scheduled competitor refresh could not be confirmed'},{status:503})
  }
}
export async function POST(req:NextRequest) {return GET(req)}
