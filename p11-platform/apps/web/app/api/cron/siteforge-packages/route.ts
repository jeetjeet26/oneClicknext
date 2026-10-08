import { NextRequest,NextResponse } from 'next/server'
import { hasValidCronAuth } from '@/utils/services/api-helpers'
import { packageDb } from '@/utils/siteforge/packages/store'
import { processPackage } from '@/utils/siteforge/packages/runner'
export const maxDuration=300
export async function GET(request:NextRequest) {
  if(!hasValidCronAuth(request)) return NextResponse.json({error:'Unauthorized'},{status:401})
  const {data,error}=await packageDb().from('siteforge_package_jobs').select('id').in('state',['queued','preparing','starting','generating','packaging']).order('updated_at',{ascending:true}).limit(2)
  if(error) return NextResponse.json({error:'Website builds could not be checked.'},{status:503})
  const results=[]
  for(const job of data) {
    try {results.push({id:job.id,state:(await processPackage(job.id)).state})}
    catch {results.push({id:job.id,state:'retry_pending'})}
  }
  return NextResponse.json({results},{headers:{'Cache-Control':'no-store'}})
}
