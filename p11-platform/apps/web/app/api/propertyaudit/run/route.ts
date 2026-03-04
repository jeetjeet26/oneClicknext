/**
 * PropertyAudit Run API
 * Trigger and manage GEO audit runs
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'

export interface GeoRun {
  id: string
  propertyId: string
  surface: 'openai' | 'claude'
  modelName: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  queryCount: number
  startedAt: string
  finishedAt: string | null
  errorMessage: string | null
}

// POST: Trigger a new GEO audit run
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { propertyId, surfaces = ['openai', 'claude'], executionCount = 1 } = body

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    // Validate executionCount
    const validExecutionCount = Math.max(1, Math.min(5, parseInt(executionCount as any) || 1))

    const serviceClient = createServiceClient()

    // Get query count for this property
    const { data: queryRows, count: queryCount } = await serviceClient
      .from('geo_queries')
      .select('id', { count: 'exact' })
      .eq('property_id', propertyId)
      .eq('is_active', true)

    if (!queryCount || queryCount === 0) {
      return NextResponse.json({ 
        error: 'No active queries found. Generate a query panel first.',
        code: 'NO_QUERIES'
      }, { status: 400 })
    }

    // Apply global execution count to all queries
    const totalQueryExecutions = queryCount * validExecutionCount

    // Create runs for each surface with shared batch_id
    const runs: GeoRun[] = []
    const batchId = crypto.randomUUID() // Group related runs together
    const modelNames: Record<'openai' | 'claude', string> = {
      openai: process.env.GEO_OPENAI_MODEL || 'gpt-5.2',
      claude: process.env.GEO_CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    }

    for (const surface of surfaces) {
      if (surface !== 'openai' && surface !== 'claude') continue

      const typedSurface = surface as 'openai' | 'claude';

      const { data: run, error: runError } = await serviceClient
        .from('geo_runs')
        .insert({
          property_id: propertyId,
          surface: typedSurface,
          model_name: modelNames[typedSurface],
          status: 'queued',
          query_count: totalQueryExecutions,
          execution_count: validExecutionCount,
          started_at: new Date().toISOString(),
          batch_id: batchId,
          batch_size: surfaces.length
        })
        .select()
        .single()

      if (runError) {
        console.error(`Error creating ${surface} run:`, runError)
        continue
      }

      runs.push(formatRun(run))
    }
    
    console.log(`✅ [PropertyAudit] Created batch ${batchId} with ${runs.length} runs`)

    if (runs.length === 0) {
      return NextResponse.json({ error: 'Failed to create runs' }, { status: 500 })
    }

    // Trigger processing - prefer batch execution for parallel processing
    // Feature flag: Use data-engine or TypeScript processor
    const USE_DATA_ENGINE = process.env.PROPERTYAUDIT_USE_DATA_ENGINE === 'true'
    const baseUrl = req.nextUrl.origin
    
    if (USE_DATA_ENGINE) {
      // ============================================================
      // PARALLEL EXECUTION: Fire separate HTTP requests for each run
      // HTTP-level parallelism is more reliable than in-process asyncio
      // Each run executes independently on the data-engine
      // ============================================================
      const dataEngineUrl = process.env.DATA_ENGINE_URL || 'http://localhost:8000'
      const apiKey = process.env.DATA_ENGINE_API_KEY
      
      if (!apiKey) {
        console.warn('⚠️  DATA_ENGINE_API_KEY not set - data-engine may reject request')
      }
      
      console.log(`🚀 [PropertyAudit] Firing ${runs.length} PARALLEL HTTP requests to data-engine`)
      
      // Fire all requests in parallel (fire-and-forget)
      const promises = runs.map(run => {
        console.log(`🚀 [PropertyAudit] Starting ${run.surface.toUpperCase()} run ${run.id}`)
        
        return fetch(`${dataEngineUrl}/jobs/propertyaudit/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey || '',
            'X-Correlation-ID': run.id,
          },
          body: JSON.stringify({ 
            run_id: run.id,
            surface: run.surface,
            batch_id: batchId  // Include batch_id for cross-model analysis later
          }),
        })
          .then(response => {
            if (!response.ok) {
              throw new Error(`Data-engine returned ${response.status}`)
            }
            return response.json()
          })
          .then(data => {
            console.log(`✅ [PropertyAudit] ${run.surface.toUpperCase()} run ${run.id} accepted:`, data)
            return { success: true, run, data }
          })
          .catch(async (err) => {
            console.error(`❌ [PropertyAudit] ${run.surface.toUpperCase()} run ${run.id} failed:`, err)
            await serviceClient
              .from('geo_runs')
              .update({ 
                status: 'failed', 
                error_message: `Data-engine error: ${err.message}`,
                finished_at: new Date().toISOString()
              })
              .eq('id', run.id)
            return { success: false, run, error: err.message }
          })
      })
      
      // Don't await - let them run in background
      Promise.all(promises).then(results => {
        const succeeded = results.filter(r => r.success).length
        console.log(`✅ [PropertyAudit] Batch ${batchId}: ${succeeded}/${runs.length} runs accepted by data-engine`)
      })
      
    } else {
      // ============================================================
      // OPTION 3: TypeScript Execution (Legacy, has timeout issues)
      // ============================================================
      for (const run of runs) {
        console.log(`⚠️  [PropertyAudit] Using TypeScript processor (legacy) for run ${run.id}`)
        
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 600000) // 10 minute timeout
        
        fetch(`${baseUrl}/api/propertyaudit/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: run.id }),
          signal: controller.signal,
        })
          .then(() => clearTimeout(timeoutId))
          .catch(err => {
            clearTimeout(timeoutId)
            if (err.name !== 'AbortError') {
              console.error(`Failed to trigger processing for run ${run.id}:`, err)
            }
          })
      }
    }

    return NextResponse.json({
      success: true,
      runs,
      message: `Created ${runs.length} run(s) for ${queryCount} queries × ${validExecutionCount} executions = ${totalQueryExecutions} total LLM calls. Processing started.`,
    })
  } catch (error) {
    console.error('PropertyAudit Run POST Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH: Update run status (used by processor)
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { runId, status, errorMessage } = body

    if (!runId) {
      return NextResponse.json({ error: 'runId required' }, { status: 400 })
    }

    const updateData: Record<string, unknown> = {}
    
    if (status) {
      updateData.status = status
      if (status === 'completed' || status === 'failed') {
        updateData.finished_at = new Date().toISOString()
      }
    }

    if (errorMessage !== undefined) {
      updateData.error_message = errorMessage
    }

    const serviceClient = createServiceClient()
    const { data: run, error } = await serviceClient
      .from('geo_runs')
      .update(updateData)
      .eq('id', runId)
      .select()
      .single()

    if (error) {
      console.error('Error updating run:', error)
      return NextResponse.json({ error: 'Failed to update run' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      run: formatRun(run),
    })
  } catch (error) {
    console.error('PropertyAudit Run PATCH Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Format run for API response
function formatRun(run: Record<string, unknown>): GeoRun {
  return {
    id: run.id as string,
    propertyId: run.property_id as string,
    surface: run.surface as 'openai' | 'claude',
    modelName: run.model_name as string,
    status: run.status as GeoRun['status'],
    queryCount: run.query_count as number,
    startedAt: run.started_at as string,
    finishedAt: run.finished_at as string | null,
    errorMessage: run.error_message as string | null,
  }
}



