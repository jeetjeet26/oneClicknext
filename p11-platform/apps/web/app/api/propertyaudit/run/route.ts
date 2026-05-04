/**
 * PropertyAudit Run API
 * Trigger and manage GEO audit runs
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { getDataEngineUrl } from '@/utils/services/runtime-config'
import {
  classifyProviderFailure,
  DEFAULT_AUDIT_SURFACES,
  getDefaultAuditMode,
  getSurfaceModelName,
  isSupportedSurface,
  type Surface,
} from '@/utils/propertyaudit/types'

const DATA_ENGINE_DISPATCH_TIMEOUT_MS = 15000
const TYPESCRIPT_PROCESS_TIMEOUT_MS = 600000

export interface GeoRun {
  id: string
  propertyId: string
  surface: Surface
  modelName: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  queryCount: number
  startedAt: string
  finishedAt: string | null
  errorMessage: string | null
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isDataEngineSupportedSurface(surface: Surface): boolean {
  return isSupportedSurface(surface)
}

async function readResponseError(response: Response): Promise<string> {
  try {
    const body = await response.json()
    if (typeof body?.details === 'string' && body.details.length > 0) {
      return `${body.error || response.statusText}: ${body.details}`
    }
    if (typeof body?.detail === 'string' && body.detail.length > 0) {
      return body.detail
    }
    if (typeof body?.error === 'string' && body.error.length > 0) {
      return body.error
    }
  } catch {
    // Fall back to plain text below.
  }

  const text = await response.text().catch(() => '')
  return text || `Request failed with ${response.status}`
}

async function markDispatchFailed(
  serviceClient: ReturnType<typeof createServiceClient>,
  runId: string,
  message: string
) {
  await serviceClient
    .from('geo_runs')
    .update({
      status: 'failed',
      error_message: message,
      provider_failure_reason: classifyProviderFailure(message),
      finished_at: new Date().toISOString(),
    })
    .eq('id', runId)
}

async function triggerTypeScriptProcessor(options: {
  baseUrl: string
  cronSecret?: string
  sessionCookie?: string
  runId: string
  useLocalFixture?: boolean
}) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TYPESCRIPT_PROCESS_TIMEOUT_MS)

  try {
    const response = await fetch(`${options.baseUrl}/api/propertyaudit/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.cronSecret ? { Authorization: `Bearer ${options.cronSecret}` } : {}),
        ...(options.sessionCookie ? { Cookie: options.sessionCookie } : {}),
        ...(options.useLocalFixture ? { 'X-PropertyAudit-Local-Fixture': '1' } : {}),
      },
      body: JSON.stringify({ runId: options.runId }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(await readResponseError(response))
    }
  } finally {
    clearTimeout(timeoutId)
  }
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
    const {
      propertyId,
      surfaces = DEFAULT_AUDIT_SURFACES,
      executionCount = 1,
      promptSource = 'generated',
      accessMode = 'URLOnly',
      useLocalFixture = false,
    } = body

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Validate executionCount
    const validExecutionCount = Math.max(1, Math.min(5, Number(executionCount) || 1))
    const requestedSurfaces = Array.isArray(surfaces) ? surfaces : []
    const normalizedSurfaces = Array.from(
      new Set(
        requestedSurfaces.filter(
          (surface): surface is Surface => typeof surface === 'string' && isSupportedSurface(surface)
        )
      )
    )

    if (normalizedSurfaces.length === 0) {
      return NextResponse.json(
        { error: 'At least one supported surface is required.' },
        { status: 400 }
      )
    }

    const serviceClient = createServiceClient()

    // Get query count for this property
    const { count: queryCount } = await serviceClient
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
    const allowLocalFixture = process.env.NODE_ENV !== 'production' && useLocalFixture === true
    const useDataEngine = process.env.PROPERTYAUDIT_USE_DATA_ENGINE !== 'false' && !allowLocalFixture
    const cronSecret = process.env.CRON_SECRET
    const auditMode = getDefaultAuditMode()

    const sessionCookie = allowLocalFixture ? req.headers.get('cookie') || '' : ''

    if (!useDataEngine && !allowLocalFixture) {
      return NextResponse.json(
        { error: 'PropertyAudit requires data-engine dispatch. Set PROPERTYAUDIT_USE_DATA_ENGINE=true or remove the explicit false override.' },
        { status: 500 }
      )
    }

    if (allowLocalFixture && !cronSecret && !sessionCookie) {
      return NextResponse.json(
        { error: 'CRON_SECRET or a user session is required for deterministic local fixture processing' },
        { status: 500 }
      )
    }

    // Create runs for each surface with shared batch_id
    const runs: GeoRun[] = []
    const batchId = crypto.randomUUID() // Group related runs together

    for (const surface of normalizedSurfaces) {
      const { data: run, error: runError } = await serviceClient
        .from('geo_runs')
        .insert({
          property_id: propertyId,
          surface,
          model_name: getSurfaceModelName(surface),
          status: 'queued',
          query_count: totalQueryExecutions,
          execution_count: validExecutionCount,
          prompt_source: promptSource,
          access_mode: accessMode,
          measurement_mode: allowLocalFixture ? 'local_fixture' : auditMode,
          run_metadata: {
            selected_surfaces: normalizedSurfaces,
            dispatch_preference: useDataEngine ? 'data_engine' : 'typescript',
            prompt_source: promptSource,
            access_mode: accessMode,
            measurement_mode: allowLocalFixture ? 'local_fixture' : auditMode,
          },
          started_at: new Date().toISOString(),
          batch_id: batchId,
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
    const baseUrl = req.nextUrl?.origin || new URL(req.url).origin
    const runsForDataEngine = useDataEngine
      ? runs.filter(run => isDataEngineSupportedSurface(run.surface))
      : []
    const runsForTypeScript = runs.filter(run => !runsForDataEngine.some(candidate => candidate.id === run.id))

    if (runsForDataEngine.length > 0) {
      // Dispatch every normal PropertyAudit run to the data-engine. The web
      // processor is reserved for deterministic local fixtures only.
      const dataEngineUrl = getDataEngineUrl()
      const apiKey = process.env.DATA_ENGINE_API_KEY
      
      if (!apiKey) {
        console.warn('⚠️  DATA_ENGINE_API_KEY not set - data-engine may reject request')
      }
      
      console.log(`🚀 [PropertyAudit] Firing ${runsForDataEngine.length} PARALLEL HTTP requests to data-engine`)
      
      // Fire all requests in parallel (fire-and-forget)
      const promises = runsForDataEngine.map(run => {
        console.log(`🚀 [PropertyAudit] Starting ${run.surface.toUpperCase()} run ${run.id}`)
        
        return (async () => {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), DATA_ENGINE_DISPATCH_TIMEOUT_MS)

          try {
            const response = await fetch(`${dataEngineUrl}/jobs/propertyaudit/run`, {
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
              signal: controller.signal,
            })

            if (!response.ok) {
              const dispatchError = await readResponseError(response)
              if (
                response.status === 409 &&
                /(not queued|already started|already finished|status=running|status=completed|status=failed)/i.test(
                  dispatchError
                )
              ) {
                console.warn(
                  `⚠️ [PropertyAudit] ${run.surface.toUpperCase()} run ${run.id} already claimed by another processor: ${dispatchError}`
                )
                return {
                  success: true,
                  run,
                  mode: 'data_engine_already_claimed' as const,
                  note: dispatchError,
                }
              }
              throw new Error(dispatchError)
            }

            const data = await response.json()
            console.log(`✅ [PropertyAudit] ${run.surface.toUpperCase()} run ${run.id} accepted:`, data)
            return { success: true, run, mode: 'data_engine' as const, data }
          } catch (error) {
            const dispatchError = getErrorMessage(error)
            console.error(`❌ [PropertyAudit] ${run.surface.toUpperCase()} run ${run.id} failed:`, error)

            await markDispatchFailed(serviceClient, run.id, `Data-engine dispatch failed: ${dispatchError}`)
            return { success: false, run, mode: 'failed' as const, error: dispatchError }
          } finally {
            clearTimeout(timeoutId)
          }
        })()
      })
      
      // Don't await - let them run in background
      Promise.all(promises).then(results => {
        const succeeded = results.filter(r => r.success).length
        console.log(
          `✅ [PropertyAudit] Batch ${batchId}: ${succeeded}/${runsForDataEngine.length} runs dispatched to data-engine`
        )
      })
    }

    if (runsForTypeScript.length > 0) {
      // ============================================================
      // TypeScript execution is only for deterministic local fixture runs.
      // ============================================================
      for (const run of runsForTypeScript) {
        console.log(`⚠️  [PropertyAudit] Using TypeScript processor for run ${run.id} (${run.surface})`)

        if (!cronSecret && !sessionCookie) {
          await markDispatchFailed(serviceClient, run.id, 'CRON_SECRET missing for TypeScript processing')
          continue
        }

        void triggerTypeScriptProcessor({
          baseUrl,
          cronSecret,
          sessionCookie,
          runId: run.id,
          useLocalFixture: allowLocalFixture,
        }).catch(async (error) => {
          const message = getErrorMessage(error)
          console.error(`Failed to trigger processing for run ${run.id}:`, error)
          await markDispatchFailed(serviceClient, run.id, `TypeScript processor dispatch failed: ${message}`)
        })
      }
    }

    return NextResponse.json({
      success: true,
      runs,
      processorMode: allowLocalFixture
        ? 'typescript_fixture'
        : runsForDataEngine.length > 0 && runsForTypeScript.length > 0
          ? 'mixed'
          : runsForDataEngine.length > 0
            ? 'data_engine'
            : 'typescript',
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

    const serviceClient = createServiceClient()
    const { data: runRecord, error: runFetchError } = await serviceClient
      .from('geo_runs')
      .select('id, property_id')
      .eq('id', runId)
      .single()

    if (runFetchError || !runRecord) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, runRecord.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
    surface: run.surface as Surface,
    modelName: run.model_name as string,
    status: run.status as GeoRun['status'],
    queryCount: run.query_count as number,
    startedAt: run.started_at as string,
    finishedAt: run.finished_at as string | null,
    errorMessage: run.error_message as string | null,
  }
}



