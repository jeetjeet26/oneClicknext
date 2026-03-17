/**
 * PropertyAudit Cross-Model Analysis API
 * Retrieves and triggers cross-model analysis for batch runs
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

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

    const serviceClient = createServiceClient()

    // Build query based on parameters
    let query = serviceClient
      .from('geo_runs')
      .select(`
        id,
        surface,
        status,
        batch_id,
        cross_model_analysis,
        started_at,
        finished_at,
        geo_scores (
          overall_score,
          visibility_pct,
          avg_llm_rank,
          avg_link_rank,
          avg_sov
        )
      `)
      .order('started_at', { ascending: false })

    if (batchId) {
      query = query.eq('batch_id', batchId)
    } else if (propertyId) {
      // Get the latest batch for the property
      query = query.eq('property_id', propertyId).limit(10)
    }

    const { data: runs, error: runsError } = await query

    if (runsError) {
      console.error('Error fetching runs:', runsError)
      return NextResponse.json({ error: 'Failed to fetch analysis' }, { status: 500 })
    }

    if (!runs || runs.length === 0) {
      return NextResponse.json({ 
        error: 'No runs found',
        batchId,
        propertyId
      }, { status: 404 })
    }

    // Group runs by batch
    const batches = new Map<string, typeof runs>()
    for (const run of runs) {
      const bid = run.batch_id
      if (bid) {
        if (!batches.has(bid)) {
          batches.set(bid, [])
        }
        batches.get(bid)!.push(run)
      }
    }

    // Get the target batch (specified or most recent)
    const targetBatchId = batchId || runs[0]?.batch_id
    if (!targetBatchId) {
      return NextResponse.json({
        error: 'No batch runs found',
        batchId,
        propertyId,
      }, { status: 404 })
    }

    const batchRuns = batches.get(targetBatchId) || []

    // Extract cross-model analysis (same on all runs in batch)
    const analysis = batchRuns.find(r => r.cross_model_analysis)?.cross_model_analysis as CrossModelAnalysis | null

    // Build per-model scores
    const openaiRun = batchRuns.find(r => r.surface === 'openai')
    const claudeRun = batchRuns.find(r => r.surface === 'claude')

    const scores = {
      openai: openaiRun?.geo_scores?.[0] || null,
      claude: claudeRun?.geo_scores?.[0] || null
    }

    // Determine batch status
    const allCompleted = batchRuns.every(r => r.status === 'completed')
    const anyFailed = batchRuns.some(r => r.status === 'failed')
    const anyRunning = batchRuns.some(r => r.status === 'running' || r.status === 'queued')

    let batchStatus: 'pending' | 'running' | 'completed' | 'partial' | 'failed'
    if (anyRunning) {
      batchStatus = 'running'
    } else if (allCompleted) {
      batchStatus = 'completed'
    } else if (anyFailed && !allCompleted) {
      batchStatus = 'partial'
    } else if (anyFailed) {
      batchStatus = 'failed'
    } else {
      batchStatus = 'pending'
    }

    return NextResponse.json({
      success: true,
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
        scoreDifference: analysis.score_comparison?.difference,
        higherModel: analysis.score_comparison?.higher_model,
        keyInsightsCount: analysis.recommendations?.key_insights?.length || 0,
        actionItemsCount: analysis.recommendations?.action_items?.length || 0
      } : null
    })

  } catch (error) {
    console.error('PropertyAudit Analysis GET Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST: Trigger re-analysis for a batch
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { batchId } = body

    if (!batchId) {
      return NextResponse.json({ error: 'batchId required' }, { status: 400 })
    }

    const propertyId = await resolveBatchPropertyId(batchId)
    if (!propertyId) {
      return NextResponse.json({ error: 'No runs found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Call data-engine to re-run analysis
    const dataEngineUrl = process.env.DATA_ENGINE_URL || 'http://localhost:8000'
    const apiKey = process.env.DATA_ENGINE_API_KEY

    if (!apiKey) {
      return NextResponse.json({ 
        error: 'DATA_ENGINE_API_KEY not configured' 
      }, { status: 500 })
    }

    const response = await fetch(`${dataEngineUrl}/jobs/propertyaudit/batch/${batchId}/reanalyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.detail || `Data-engine returned ${response.status}`)
    }

    const result = await response.json()

    return NextResponse.json({
      success: result.success,
      batchId,
      message: result.message || 'Cross-model analysis re-triggered',
      agreementRate: result.agreement_rate
    })

  } catch (error) {
    console.error('PropertyAudit Analysis POST Error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 })
  }
}






