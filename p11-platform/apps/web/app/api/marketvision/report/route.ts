/**
 * MarketVision 360 - Competitive Report Generation API
 * Generate comprehensive market analysis reports
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

import {AnalysisQuery,analyzeMarket} from '@/utils/marketvision/analysis'
import {readMarketAnalysis} from '@/utils/marketvision/analysis-store'
import {marketError} from '@/utils/marketvision/decision-store'

export async function GET(req:NextRequest) {
  try {
    const {data:{user},error}=await(await createClient()).auth.getUser()
    if(error||!user)return NextResponse.json({error:'Unauthorized'},{status:401})
    const params=req.nextUrl.searchParams,propertyId=params.get('propertyId')
    if(!propertyId)return NextResponse.json({error:'propertyId required'},{status:400})
    if(!(await validatePropertyAccess(user.id,propertyId)).authorized)return NextResponse.json({error:'Forbidden'},{status:403})
    const raw=Object.fromEntries(params),format=raw.format??'json';delete raw.format
    const parsed=AnalysisQuery.safeParse({...raw,type:'summary'})
    if(!parsed.success||!['json','summary'].includes(format)||params.has('type')||[...params.keys()].length!==Object.keys(Object.fromEntries(params)).length)return NextResponse.json({error:'Choose valid report filters.'},{status:400})
    const snapshot=await readMarketAnalysis(propertyId,user.id,parsed.data.days)
    const analysis=analyzeMarket(snapshot,parsed.data)
    const report={...analysis,propertyName:snapshot.propertyName,generatedAt:snapshot.snapshotAt,period:{start:snapshot.windowStart,end:snapshot.snapshotAt},recommendations:[],recommendationStatus:'Review source coverage and comparable terms before making pricing decisions.'}
    return NextResponse.json(format==='summary'?{summary:report.summary,coverage:analysis.trendCoverage,methodology:analysis.methodology,limitations:analysis.limitations,generatedAt:report.generatedAt}:{report},{headers:{'Cache-Control':'private, no-store'}})
  }catch(error){return marketError(error)}
}

// Reports are saved through the exact-source brief workflow.
export async function POST(req:NextRequest){try{const {data:{user},error}=await(await createClient()).auth.getUser();if(error||!user)return NextResponse.json({error:'Unauthorized'},{status:401});const body=await req.json().catch(()=>({}));if(!body.propertyId)return NextResponse.json({error:'propertyId required'},{status:400});if(!(await validatePropertyAccess(user.id,body.propertyId)).authorized)return NextResponse.json({error:'Forbidden'},{status:403});return NextResponse.json({error:'Use the saved market brief workflow to record an exact-source report.'},{status:410})}catch(error){return marketError(error)}}
