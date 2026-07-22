/**
 * MarketVision 360 - Governed proposals
 *
 * POST packages a Market Brief recommendation as a shared action attempt
 * (always `proposed`; never auto-executed). GET lists proposals with their
 * decision, execution state, and any recorded downstream outcomes.
 *
 * Approve/deny/modify decisions flow through /api/substrate/approvals.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  createMarketVisionProposal,
  listMarketVisionProposals,
  MarketVisionProposalError,
  MARKETVISION_PROPOSAL_TYPES,
  type MarketVisionProposalType,
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

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { propertyId, proposalType, recommendation } = body

    if (!propertyId || !proposalType || !recommendation) {
      return NextResponse.json(
        { error: 'propertyId, proposalType, and recommendation are required' },
        { status: 400 }
      )
    }

    if (!MARKETVISION_PROPOSAL_TYPES.includes(proposalType)) {
      return NextResponse.json(
        { error: `proposalType must be one of ${MARKETVISION_PROPOSAL_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    if (
      typeof recommendation.id !== 'string' ||
      typeof recommendation.title !== 'string' ||
      typeof recommendation.rationale !== 'string'
    ) {
      return NextResponse.json(
        { error: 'recommendation must include id, title, and rationale' },
        { status: 400 }
      )
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: property, error: propertyError } = await supabase
      .from('properties')
      .select('org_id')
      .eq('id', propertyId)
      .single()

    if (propertyError || !property?.org_id) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    const result = await createMarketVisionProposal({
      orgId: property.org_id,
      propertyId,
      requestedBy: user.id,
      proposalType: proposalType as MarketVisionProposalType,
      recommendation: {
        id: recommendation.id,
        recommendationType: recommendation.recommendationType ?? 'operator_task',
        title: recommendation.title,
        rationale: recommendation.rationale,
        impact: Number(recommendation.impact ?? 0),
        confidence: Number(recommendation.confidence ?? 0),
        freshness: Number(recommendation.freshness ?? 0),
        reversibility: Number(recommendation.reversibility ?? 1),
        citations: Array.isArray(recommendation.citations) ? recommendation.citations : [],
      },
      executionPayload: body.executionPayload,
    })

    return NextResponse.json(
      {
        success: true,
        proposal: result,
        message: 'Proposal created and awaiting review',
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof MarketVisionProposalError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('MarketVision Proposals POST Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
