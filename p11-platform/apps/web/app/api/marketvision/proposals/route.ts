/**
 * MarketVision 360 - Governed proposals
 *
 * Earlier proposals remain readable. New work uses the saved handoff route.
 */

import {requireMarketOperator,marketError} from '@/utils/marketvision/decision-store'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  listMarketVisionProposals,
  MarketVisionProposalError,
} from '@/utils/services/marketvision-proposals'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const propertyId = req.nextUrl.searchParams.get('propertyId')
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '20', 10) || 20, 100)

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const proposals = await listMarketVisionProposals(propertyId, limit)
    return NextResponse.json({ proposals, total: proposals.length })
  } catch (error) {
    if (error instanceof MarketVisionProposalError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('MarketVision Proposals GET Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req:NextRequest){
 try{const body=await req.json().catch(()=>({}));await requireMarketOperator(String(body.propertyId??''));return NextResponse.json({error:'Create a handoff from a reviewed saved brief in MarketVision. Earlier proposals remain historical records.'},{status:410,headers:{'Cache-Control':'private, no-store'}})}catch(e){return marketError(e)}
}
