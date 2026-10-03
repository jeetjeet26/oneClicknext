/**
 * PropertyAudit Cross-Model Analysis API
 * Retrieves and triggers cross-model analysis for batch runs
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { readMeasurements } from '@/utils/propertyaudit/read-measurements'
import { measurementBatchStatus } from '@/utils/propertyaudit/measurement-source'

export interface CrossModelAnalysis {
  analyzed_at: string
  agreement_rate: number
  score_comparison: {
    openai_overall: number
    claude_overall: number
    difference: number
    higher_model: 'openai' | 'claude'
  }
  visibility_comparison: {
    openai_visibility: number
    claude_visibility: number
    difference: number
  }
  recommendations: {
    summary: string
    key_insights: Array<{
      insight: string
      priority: 'high' | 'medium' | 'low'
      action: string
    }>
    action_items: Array<{
      action: string
      priority: number
      effort: 'low' | 'medium' | 'high'
      impact: 'low' | 'medium' | 'high'
    }>
  }
}

async function resolveBatchPropertyId(batchId: string): Promise<string | null> {
  const serviceClient = createServiceClient()
  const { data: batchRuns, error } = await serviceClient
    .from('geo_runs')
    .select('property_id')
    .eq('batch_id', batchId)
    .limit(1)

  if (error || !batchRuns || batchRuns.length === 0) {
    return null
  }

  return batchRuns[0]?.property_id ?? null
}

// GET: Retrieve cross-model analysis for a batch
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const batchId = searchParams.get('batchId')
    const propertyId = searchParams.get('propertyId')

    if (!batchId && !propertyId) {
      return NextResponse.json({ 
        error: 'Either batchId or propertyId required' 
      }, { status: 400 })
    }

    const scopedPropertyId = propertyId ?? (batchId ? await resolveBatchPropertyId(batchId) : null)
    if (!scopedPropertyId) {
      return NextResponse.json({
        error: 'No runs found',
        batchId,
        propertyId,
      }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, scopedPropertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const source = await readMeasurements(user.id, scopedPropertyId, {kind:'batch', ...(batchId ? {batchId} : {})})
    if (source.state !== 'ready') return NextResponse.json({error:'Audit measurements unavailable', state:source.state}, {status:source.state === 'forbidden' ? 403 : 409})
    const batchRuns = source.runs.map(entry => ({...entry.run, geo_scores:entry.scores}))
    if (!batchRuns.length) return NextResponse.json({error:'No runs found', batchId, propertyId}, {status:404})
    const targetBatchId = source.batchId
    // Extract cross-model analysis (same on all runs in batch)
    const analysis = batchRuns.find(r => r.cross_model_analysis)?.cross_model_analysis as CrossModelAnalysis | null

    // Build per-surface scores for two-surface legacy and four-surface v1 batches.
    const scores = Object.fromEntries(
      batchRuns.map(r => [r.surface, r.status === 'completed' ? r.geo_scores?.[0] || null : null])
    )
    const scoredRuns = batchRuns.filter(run => run.status === 'completed')
      .map(run => ({
        surface: run.surface,
        score: run.geo_scores?.[0]?.overall_score ?? null,
        visibility: run.geo_scores?.[0]?.visibility_pct ?? null,
      }))
      .filter(run => typeof run.score === 'number')
    const highest = [...scoredRuns].sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null
    const lowest = [...scoredRuns].sort((a, b) => (a.score || 0) - (b.score || 0))[0] || null
    const scoreDifference = scoredRuns.length >= 2 && highest && lowest ? Math.abs((highest.score || 0) - (lowest.score || 0)) : null

    const batchStatus = measurementBatchStatus(batchRuns)

    return NextResponse.json({
      success: true,
      scope: source.scope,
      batchId: targetBatchId,
      batchStatus,
      runs: batchRuns.map(r => ({
        id: r.id,
        surface: r.surface,
        status: r.status,
        startedAt: r.started_at,
        finishedAt: r.finished_at
      })),
      scores,
      crossModelAnalysis: analysis,
      hasAnalysis: !!analysis,
      // Quick summary for UI
      summary: analysis ? {
        agreementRate: analysis.agreement_rate,
        scoreDifference: analysis.score_comparison?.difference ?? scoreDifference,
        higherModel: analysis.score_comparison?.higher_model ?? highest?.surface,
        keyInsightsCount: analysis.recommendations?.key_insights?.length || 0,
        actionItemsCount: analysis.recommendations?.action_items?.length || 0
      } : {
        agreementRate: null,
        scoreDifference,
        higherModel: highest?.surface || null,
        lowestModel: lowest?.surface || null,
        keyInsightsCount: 0,
        actionItemsCount: 0,
      }
    })

  } catch (error) {
    console.error('PropertyAudit Analysis GET Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST: Trigger re-analysis for a batch
export async function POST() {
  return NextResponse.json({error:'Use saved recommendation requests and review their retained results in PropertyAudit.',replacement:'/api/propertyaudit/recommendation-work'}, {status:410})
}
