import { createHash } from 'node:crypto'
import { NextRequest,NextResponse } from 'next/server'
import type { createServiceClient } from '@/utils/supabase/admin'
import { phaseFourDb } from './phase-four-db'

export async function admitLumaRead(db:ReturnType<typeof createServiceClient>,req:NextRequest,propertyId:string,headers:Record<string,string>) {
  const minute=Math.floor(Date.now()/60000)
  const actor=createHash('sha256').update(req.headers.get('x-forwarded-for')?.split(',')[0] || 'anonymous').digest('hex')
  for(const [bucket,limit] of [[`read:${minute}`,600],[`read:${minute}:${actor}`,120]] as const) {
    const result=await phaseFourDb(db).rpc('reserve_luma_allowance',{p_property_id:propertyId,p_bucket:bucket,p_units:1,p_limit:limit,p_expires_at:new Date((minute+2)*60000).toISOString()})
    if(result.error || result.data===null) return NextResponse.json({error:'Widget is temporarily unavailable'},{status:503,headers})
    if(!result.data) return NextResponse.json({error:'Please wait before trying again'},{status:429,headers:{...headers,'Retry-After':'60'}})
  }
  return null
}
