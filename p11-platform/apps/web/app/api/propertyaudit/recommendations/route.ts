/**
 * PropertyAudit Recommendations API
 * Generate actionable content suggestions from GEO data
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { generateRecommendations } from '@/utils/propertyaudit/recommendation-engine'

// GET: Generate recommendations for a property
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const propertyId = searchParams.get('propertyId')
    const runId = searchParams.get('runId') || undefined
    const batchId = searchParams.get('batchId') || undefined

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Generate recommendations
    const { recommendations, summary } = await generateRecommendations(propertyId, { runId, batchId })

    return NextResponse.json({
      recommendations,
      summary,
      propertyId,
      runId: runId || null,
      batchId: batchId || null,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('PropertyAudit Recommendations Error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
