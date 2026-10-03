import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { AnalysisQuery, analyzeMarket } from '@/utils/marketvision/analysis'
import { readMarketAnalysis } from '@/utils/marketvision/analysis-store'
import { marketError } from '@/utils/marketvision/decision-store'
export async function GET(req:NextRequest) {
  try {
    const {data:{user},error}=await(await createClient()).auth.getUser()
    if(error||!user)return NextResponse.json({error:'Unauthorized'},{status:401})
    const raw=Object.fromEntries(req.nextUrl.searchParams)
    if(!raw.propertyId)return NextResponse.json({error:'propertyId required'},{status:400})
    if(!(await validatePropertyAccess(user.id,raw.propertyId)).authorized)return NextResponse.json({error:'Forbidden'},{status:403})
    const parsed=AnalysisQuery.safeParse(raw)
    if(!parsed.success || [...req.nextUrl.searchParams.keys()].length!==Object.keys(raw).length)return NextResponse.json({error:'Choose valid report filters and a window of 1–366 days.'},{status:400})
    const q=parsed.data, snapshot=await readMarketAnalysis(q.propertyId,user.id,Math.max(q.days,q.type==='summary'?7:1))
    const result=analyzeMarket(snapshot,q)
    // One snapshot supplies every metric, including the coverage and citation metadata.
    return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}})
  }catch(error){return marketError(error)}
}
