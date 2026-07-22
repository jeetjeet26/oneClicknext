/**
 * MarketVision 360 - Brand Intelligence Job Status API
 * Poll extraction job status
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { getDataEngineHeaders, getDataEngineUrl } from '@/utils/services/runtime-config'
import { deriveJobResult, toCanonicalJobStatus } from '@/components/marketvision/types'

// Data engine service URL (Python FastAPI)
const DATA_ENGINE_URL = getDataEngineUrl()

// GET: Get job status
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { jobId } = await params

    if (!jobId) {
      return NextResponse.json({ error: 'jobId required' }, { status: 400 })
    }

    const { data: job } = await supabase
      .from('competitor_scrape_jobs')
      .select('property_id')
      .eq('id', jobId)
      .single()

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (typeof job.property_id !== 'string') {
      return NextResponse.json({ error: 'Job property mapping is invalid' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, job.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Call data-engine to get job status (property_id re-checked service-side)
    const response = await fetch(
      `${DATA_ENGINE_URL}/scraper/brand-intelligence/job/${jobId}?property_id=${encodeURIComponent(job.property_id)}`,
      {
        method: 'GET',
        headers: getDataEngineHeaders()
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Data engine error:', errorText)
      return NextResponse.json({ 
        error: 'Failed to get job status',
        details: errorText
      }, { status: 502 })
    }

    // Data engine wraps the job payload as { success, data: {...} }
    const result = await response.json()
    const payload = result?.data

    if (!payload || typeof payload !== 'object') {
      console.error('Data engine returned malformed job payload:', result)
      return NextResponse.json({
        error: 'Data engine returned a malformed job payload'
      }, { status: 502 })
    }

    const processedCount = payload.processed_count ?? 0
    const failedCount = payload.failed_count ?? 0
    const status = toCanonicalJobStatus(payload.status)

    return NextResponse.json({
      success: true,
      job: {
        jobId: payload.job_id,
        status,
        rawStatus: payload.status ?? 'unknown',
        result: deriveJobResult(status, processedCount, failedCount),
        totalCompetitors: payload.total_competitors ?? 0,
        processedCount,
        failedCount,
        currentBatch: payload.current_batch ?? 0,
        totalBatches: payload.total_batches ?? 0,
        progressPercent: payload.progress_percent || 0,
        startedAt: payload.started_at ?? null,
        completedAt: payload.completed_at ?? null,
        errorMessage: payload.error_message ?? null
      }
    })
  } catch (error) {
    console.error('Brand Intelligence Job Status Error:', error)
    
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return NextResponse.json({
        error: 'Brand intelligence service unavailable',
        details: 'The data-engine service is not running'
      }, { status: 503 })
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

