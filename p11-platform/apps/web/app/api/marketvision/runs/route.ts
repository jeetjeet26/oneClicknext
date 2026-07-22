/**
 * MarketVision 360 - Durable run history
 * Lists MarketVision ingestion runs recorded in the shared job ledger so
 * operators can see what ran, when, and whether it finished, partially
 * completed, or failed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { listMarketVisionRuns } from '@/utils/services/marketvision-jobs'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const propertyId = searchParams.get('propertyId')
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10) || 20, 100)

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const runs = await listMarketVisionRuns(propertyId, limit)

    return NextResponse.json({
      runs: runs.map((run) => ({
        ...run,
        // Derived result state: partial completion is visible, not generic success.
        result:
          run.lifecycleStatus === 'succeeded'
            ? run.statusReason === 'completed_partial'
              ? 'partial'
              : 'succeeded'
            : run.lifecycleStatus,
      })),
      total: runs.length,
    })
  } catch (error) {
    console.error('MarketVision Runs GET Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
