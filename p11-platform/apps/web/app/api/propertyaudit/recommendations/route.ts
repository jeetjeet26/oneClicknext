/**
 * PropertyAudit Recommendations API
 *
 * Reads the persisted LLM-generated recommendations (geo_recommendations,
 * written by the data-engine site audit analyst). Empty until that generation
 * exists — do not substitute the generic rule-based playbook.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

const VALID_STATUSES = ['todo', 'in_progress', 'fixed', 'wont_fix'] as const

// GET: Recommendations for a property
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

    const serviceClient = createServiceClient()
    const { data: persisted, error: persistedError } = await serviceClient
      .from('geo_recommendations')
      .select('*')
      .eq('property_id', propertyId)
      .eq('is_current', true)
      .order('priority')
      .order('created_at', { ascending: false })

    if (persistedError) {
      console.error('[Recommendations] Persisted query error:', persistedError)
    }

    if (persisted && persisted.length > 0) {
      const priorityWeight: Record<string, number> = { high: 3, medium: 2, low: 1 }
      const sorted = [...persisted].sort(
        (a, b) => (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0)
      )
      return NextResponse.json({
        source: 'llm_analyst',
        recommendations: sorted,
        summary: {
          totalRecommendations: sorted.length,
          highPriority: sorted.filter(r => r.priority === 'high').length,
          mediumPriority: sorted.filter(r => r.priority === 'medium').length,
          lowPriority: sorted.filter(r => r.priority === 'low').length,
          proposedChangeCount: sorted.reduce(
            (sum, r) => sum + (Array.isArray(r.proposed_changes) ? r.proposed_changes.length : 0),
            0
          ),
          generationId: sorted[0]?.generation_id || null,
          modelUsed: sorted[0]?.model_used || null,
          generatedAt: sorted[0]?.created_at || null,
        },
        propertyId,
      })
    }

    return NextResponse.json({
      source: 'pending_analyst',
      recommendations: [],
      summary: {
        totalRecommendations: 0,
        highPriority: 0,
        mediumPriority: 0,
        lowPriority: 0,
        proposedChangeCount: 0,
        generationId: null,
        modelUsed: null,
        generatedAt: null,
      },
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

// PATCH: Update a persisted recommendation's status
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { recommendationId, status } = body as { recommendationId?: string; status?: string }

    if (!recommendationId) {
      return NextResponse.json({ error: 'recommendationId required' }, { status: 400 })
    }
    if (!status || !(VALID_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 })
    }

    const serviceClient = createServiceClient()
    const { data: recommendation, error: fetchError } = await serviceClient
      .from('geo_recommendations')
      .select('id, property_id')
      .eq('id', recommendationId)
      .single()

    if (fetchError || !recommendation) {
      return NextResponse.json({ error: 'Recommendation not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, recommendation.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: updated, error: updateError } = await serviceClient
      .from('geo_recommendations')
      .update({ status: status as (typeof VALID_STATUSES)[number], updated_at: new Date().toISOString() })
      .eq('id', recommendationId)
      .select()
      .single()

    if (updateError) {
      console.error('[Recommendations] Update error:', updateError)
      return NextResponse.json({ error: 'Failed to update recommendation' }, { status: 500 })
    }

    return NextResponse.json({ success: true, recommendation: updated })
  } catch (error) {
    console.error('PropertyAudit Recommendations PATCH Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
