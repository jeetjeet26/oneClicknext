/**
 * MarketVision durable ingestion runs.
 *
 * Wraps MarketVision ingestion work (discovery, observation refresh, brand
 * extraction, embedding, change detection, brief generation) in the shared
 * job ledger so every run is durable, deduplicated against concurrent
 * duplicates, snapshot-linked, and terminates in a canonical state.
 *
 * Partial-failure semantics: runs report per-source success/failure counts.
 * A run with some failures and some successes finishes `succeeded` with
 * status_reason `completed_partial` (a visible partial outcome), while a run
 * where every source failed finishes `failed`.
 */

import { randomUUID } from 'node:crypto'
import { createServiceClient } from '@/utils/supabase/admin'
import { runSharedExecutorJob } from '@/utils/services/shared-executor'

export const MARKETVISION_JOB_DOMAIN = 'marketvision.ingestion'

export type MarketVisionRunType =
  | 'discovery'
  | 'observation_refresh'
  | 'brand_extraction'
  | 'embedding'
  | 'change_detection'
  | 'brief_generation'

export interface MarketVisionRunOutcome<T = unknown> {
  /** Number of sources/competitors attempted (0 when not applicable). */
  total: number
  succeeded: number
  failed: number
  /** Provider/domain payload passed through to the caller. */
  data: T
}

export class MarketVisionActiveRunError extends Error {
  sharedJobId: string
  lifecycleStatus: string

  constructor(message: string, sharedJobId: string, lifecycleStatus: string) {
    super(message)
    this.name = 'MarketVisionActiveRunError'
    this.sharedJobId = sharedJobId
    this.lifecycleStatus = lifecycleStatus
  }
}

export class MarketVisionRunFailedError extends Error {
  outcome: MarketVisionRunOutcome

  constructor(message: string, outcome: MarketVisionRunOutcome) {
    super(message)
    this.name = 'MarketVisionRunFailedError'
    this.outcome = outcome
  }
}

/** Active runs older than this are treated as stale (crashed) and do not block new runs. */
const ACTIVE_RUN_STALE_MS = 30 * 60 * 1000

export async function findActiveMarketVisionRun(
  propertyId: string,
  runType: MarketVisionRunType
): Promise<{ id: string; lifecycleStatus: string } | null> {
  const supabase = createServiceClient()
  const staleCutoff = new Date(Date.now() - ACTIVE_RUN_STALE_MS).toISOString()

  const { data } = await supabase
    .from('shared_jobs')
    .select('id, lifecycle_status, updated_at')
    .eq('domain', MARKETVISION_JOB_DOMAIN)
    .eq('property_id', propertyId)
    .eq('subject_type', runType)
    .in('lifecycle_status', ['queued', 'running'])
    .gte('updated_at', staleCutoff)
    .order('updated_at', { ascending: false })
    .limit(1)

  const active = data?.[0]
  if (!active?.id) return null
  return { id: active.id, lifecycleStatus: active.lifecycle_status }
}

export interface MarketVisionIngestionJobInput<T> {
  orgId: string
  propertyId: string
  runType: MarketVisionRunType
  payload?: Record<string, unknown>
  requestedBy?: string | null
  /**
   * Perform the ingestion work and report per-source counts. Throw for a
   * total failure (provider unreachable etc.); return counts for mixed runs.
   */
  execute: () => Promise<MarketVisionRunOutcome<T>>
}

export interface MarketVisionIngestionJobResult<T> {
  sharedJobId: string | null
  outcome: MarketVisionRunOutcome<T>
  /** Derived result state: 'succeeded' | 'partial'. Failed runs throw. */
  result: 'succeeded' | 'partial'
}

async function findRunIdByDedupeKey(orgId: string, dedupeKey: string): Promise<string | null> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('shared_jobs')
    .select('id')
    .eq('org_id', orgId)
    .eq('domain', MARKETVISION_JOB_DOMAIN)
    .eq('dedupe_key', dedupeKey)
    .maybeSingle()
  return data?.id ?? null
}

/**
 * Run a MarketVision ingestion job under the shared durable-job ledger.
 *
 * - Rejects when an equivalent run is already queued/running (dedup).
 * - Ledgers the run with a context snapshot via the shared executor.
 * - Terminates in `succeeded`, `succeeded (completed_partial)`, or `failed`.
 */
export async function runMarketVisionIngestionJob<T>(
  input: MarketVisionIngestionJobInput<T>
): Promise<MarketVisionIngestionJobResult<T>> {
  const active = await findActiveMarketVisionRun(input.propertyId, input.runType)
  if (active) {
    throw new MarketVisionActiveRunError(
      `A MarketVision ${input.runType} run is already ${active.lifecycleStatus} for this property.`,
      active.id,
      active.lifecycleStatus
    )
  }

  // Unique per run: identifies this ledger row without racing concurrent runs.
  const runKey = `${input.runType}:${input.propertyId}:${randomUUID()}`
  let outcome: MarketVisionRunOutcome<T> | null = null

  try {
    await runSharedExecutorJob({
      orgId: input.orgId,
      propertyId: input.propertyId,
      domain: MARKETVISION_JOB_DOMAIN,
      subjectType: input.runType,
      subjectId: input.propertyId,
      dedupeKey: runKey,
      payload: { ...(input.payload || {}), run_type: input.runType },
      requestedBy: input.requestedBy ?? null,
      execute: async () => {
        const runOutcome = await input.execute()
        outcome = runOutcome

        if (runOutcome.total > 0 && runOutcome.succeeded === 0 && runOutcome.failed > 0) {
          throw new MarketVisionRunFailedError(
            `All ${runOutcome.failed} sources failed during ${input.runType}.`,
            runOutcome
          )
        }

        return {
          total: runOutcome.total,
          succeeded: runOutcome.succeeded,
          failed: runOutcome.failed,
        }
      },
    })
  } catch (error) {
    if (error instanceof MarketVisionRunFailedError) {
      error.outcome = outcome ?? error.outcome
    }
    throw error
  }

  if (!outcome) {
    // Unreachable: execute either returned (outcome set) or threw above.
    throw new Error('MarketVision run finished without an outcome')
  }

  const sharedJobId = await findRunIdByDedupeKey(input.orgId, runKey)
  const finishedOutcome: MarketVisionRunOutcome<T> = outcome
  const isPartial = finishedOutcome.failed > 0 && finishedOutcome.succeeded > 0

  if (isPartial && sharedJobId) {
    const supabase = createServiceClient()
    await supabase
      .from('shared_jobs')
      .update({
        status_reason: 'completed_partial',
        updated_at: new Date().toISOString(),
      })
      .eq('id', sharedJobId)
  }

  return {
    sharedJobId,
    outcome: finishedOutcome,
    result: isPartial ? 'partial' : 'succeeded',
  }
}

/** List recent MarketVision runs for a property (durable run history). */
export async function listMarketVisionRuns(
  propertyId: string,
  limit = 20
): Promise<
  Array<{
    id: string
    runType: string
    lifecycleStatus: string
    statusReason: string | null
    errorMessage: string | null
    queuedAt: string | null
    startedAt: string | null
    finishedAt: string | null
    payload: unknown
  }>
> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('shared_jobs')
    .select(
      'id, subject_type, lifecycle_status, status_reason, error_message, queued_at, started_at, finished_at, payload'
    )
    .eq('domain', MARKETVISION_JOB_DOMAIN)
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(limit)

  return (data || []).map((row) => ({
    id: row.id,
    runType: row.subject_type,
    lifecycleStatus: row.lifecycle_status,
    statusReason: row.status_reason,
    errorMessage: row.error_message,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    payload: row.payload,
  }))
}
