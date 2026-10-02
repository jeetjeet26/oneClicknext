import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { isDeliveryPaused } from '@/utils/services/delivery-guard'
import { phaseFourDb } from '@/utils/services/phase-four-db'
import { createServiceClient } from '@/utils/supabase/admin'
import { createClient } from '@/utils/supabase/server'
import { NextRequest,NextResponse } from 'next/server'

export async function GET(req:NextRequest) {
  const headers={'Cache-Control':'no-store'}
  try {
    const auth=await createClient()
    const {data:{user},error}=await auth.auth.getUser()
    if(error || !user) return NextResponse.json({error:'Unauthorized'},{status:401,headers})
    const propertyId=req.nextUrl.searchParams.get('propertyId')
    if(!propertyId) return NextResponse.json({error:'Property is required'},{status:400,headers})
    const access=await validatePropertyAccess(user.id,propertyId)
    if(!access.authorized) return NextResponse.json({error:'Forbidden'},{status:403,headers})
    const result=await phaseFourDb(createServiceClient()).rpc('phase_four_status',{p_property_id:propertyId})
    if(result.error || !result.data) throw new Error('Status unavailable')
    return NextResponse.json({status:result.data,deliveryPaused:isDeliveryPaused()},{headers})
  } catch { return NextResponse.json({error:'Operational status is temporarily unavailable'},{status:503,headers}) }
}
