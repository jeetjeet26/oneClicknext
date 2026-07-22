/**
 * MarketVision 360 - Market Brief API
 * GET: latest persisted brief for a property.
 * POST: generate a new brief on demand (durable, ledgered run).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  MarketVisionActiveRunError,
  runMarketVisionIngestionJob,
} from '@/utils/services/marketvision-jobs'
import {
  generateMarketBrief,
  getLatestMarketBrief,
  persistMarketBrief,
} from '@/utils/marketvision/brief'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const propertyId = req.nextUrl.searchParams.get('propertyId')
    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const latest = await getLatestMarketBrief(propertyId)
    if (!latest) {
      return NextResponse.json({ brief: null, briefId: null })
    }

    return NextResponse.json({ brief: latest.brief, briefId: latest.id })
  } catch (error) {
    console.error('MarketVision Brief GET Error:', error)
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

    const body = await req.json().catch(() => ({}))
    const propertyId = typeof body.propertyId === 'string' ? body.propertyId : null
    const windowDays =
      typeof body.windowDays === 'number' && body.windowDays > 0 && body.windowDays <= 90
        ? body.windowDays
        : 30

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: property, error: propError } = await supabase
      .from('properties')
      .select('id, org_id')
      .eq('id', propertyId)
      .single()

    if (propError || !property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    if (!property.org_id) {
      return NextResponse.json({ error: 'Property is missing org context' }, { status: 409 })
    }

    try {
      const run = await runMarketVisionIngestionJob({
        orgId: property.org_id,
        propertyId,
        runType: 'brief_generation',
        payload: { windowDays },
        requestedBy: user.id,
        execute: async () => {
          const brief = await generateMarketBrief(propertyId, windowDays)
          const briefId = await persistMarketBrief(brief)
          if (!briefId) {
            throw new Error('Failed to persist market brief')
          }
          return { total: 1, succeeded: 1, failed: 0, data: { brief, briefId } }
        },
      })

      return NextResponse.json(
        {
          success: true,
          briefId: run.outcome.data.briefId,
          brief: run.outcome.data.brief,
          sharedJobId: run.sharedJobId,
        },
        { status: 201 }
      )
    } catch (error) {
      if (error instanceof MarketVisionActiveRunError) {
        return NextResponse.json(
          { error: error.message, sharedJobId: error.sharedJobId },
          { status: 409 }
        )
      }
      throw error
    }
  } catch (error) {
    console.error('MarketVision Brief POST Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
