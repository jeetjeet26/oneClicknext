/**
 * MarketVision 360 - Brand Intelligence Job Status API
 * Poll extraction job status
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

// Data engine service URL (Python FastAPI)
const DATA_ENGINE_URL = process.env.DATA_ENGINE_URL || 'http://localhost:8000'

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

    // Call data-engine to get job status
    const response = await fetch(
      `${DATA_ENGINE_URL}/scraper/brand-intelligence/job/${jobId}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
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

    const result = await response.json()

    return NextResponse.json({
      success: true,
      job: {
        jobId: result.job_id,
        status: result.status,
        totalCompetitors: result.total_competitors,
        processedCount: result.processed_count,
        failedCount: result.failed_count,
        currentBatch: result.current_batch,
        totalBatches: result.total_batches,
        progressPercent: result.progress_percent || 0,
        startedAt: result.started_at,
        completedAt: result.completed_at,
        errorMessage: result.error_message
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

