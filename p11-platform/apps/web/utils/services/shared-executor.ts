import { createServiceClient } from '@/utils/supabase/admin'
import type { Json, TablesInsert, TablesUpdate } from '@/types/supabase'
import { buildBusinessContextBridge } from '@/utils/substrate/business-context-bridge'

type SharedExecutorPayload = Record<string, unknown>
type ProposalDecisionStatus = 'proposed' | 'approved' | 'denied' | 'modified'

type SharedActionLedgerInput = {
  actionType: string
  requestPayload?: SharedExecutorPayload
  executionPayload?: SharedExecutorPayload
  proposalDecisionStatus?: ProposalDecisionStatus
  policyReason?: string | null
  confidenceScore?: number | null
}

export class SharedExecutorApprovalRequiredError extends Error {
  sharedJobId: string | null
  sharedActionAttemptId: string | null

  constructor(message: string, sharedJobId: string | null, sharedActionAttemptId: string | null) {
    super(message)
    this.name = 'SharedExecutorApprovalRequiredError'
    this.sharedJobId = sharedJobId
    this.sharedActionAttemptId = sharedActionAttemptId
  }
}

export type SharedExecutorInput<T> = {
  orgId: string
  propertyId?: string | null
  domain: string
  subjectType: string
  subjectId?: string | null
  dedupeKey?: string | null
  payload?: SharedExecutorPayload
  maxAttempts?: number
  action?: SharedActionLedgerInput
  requestedBy?: string | null
  capturedBy?: string | null
  execute: () => Promise<T>
}

type ExistingSharedExecutionInput<T> = {
  sharedJobId: string
  sharedActionAttemptId?: string | null
  execute: () => Promise<T>
  statusReason?: string | null
  incrementAttemptCount?: boolean
}

function toJson(payload: SharedExecutorPayload | undefined): Json {
  return (payload || {}) as Json
}

function toJsonFromUnknown(value: unknown): Json {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) return value as Json
  if (typeof value === 'object') return value as Json
  return { value: String(value) } as Json
}

async function finalizeSharedJob(
  jobId: string,
  update: TablesUpdate<'shared_jobs'>
): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('shared_jobs').update(update).eq('id', jobId)
  if (error) {
    console.error('[shared_executor] failed to finalize shared job', { jobId, error })
  }
}

async function finalizeSharedActionAttempt(
  actionAttemptId: string,
  update: TablesUpdate<'shared_action_attempts'>
): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('shared_action_attempts')
    .update(update)
    .eq('id', actionAttemptId)
  if (error) {
    console.error('[shared_executor] failed to finalize shared action attempt', {
      actionAttemptId,
      error,
    })
  }
}

async function createSharedContextSnapshot(input: {
  orgId: string
  propertyId?: string | null
  domain: string
  subjectId?: string | null
  dedupeKey?: string | null
  capturedBy?: string | null
}): Promise<string | null> {
  if (!input.propertyId) {
    return null
  }

  const supabase = createServiceClient()
  let contextPayload: Json

  try {
    contextPayload = (await buildBusinessContextBridge(supabase, input.propertyId)) as Json
  } catch (error) {
    contextPayload = {
      error: 'context_snapshot_build_failed',
      message: error instanceof Error ? error.message : 'Unknown context snapshot failure',
    } as Json
  }

  const { data, error } = await supabase
    .from('shared_context_snapshots')
    .insert({
      org_id: input.orgId,
      property_id: input.propertyId,
      source_domain: input.domain,
      source_ref: input.subjectId ?? input.dedupeKey ?? null,
      context_payload: contextPayload,
      captured_by: input.capturedBy ?? 'system',
    })
    .select('id')
    .single()

  if (error || !data?.id) {
    console.error('[shared_executor] failed to create context snapshot', {
      domain: input.domain,
      propertyId: input.propertyId,
      error,
    })
    return null
  }

  return data.id
}

async function startSharedExecutorJob(
  input: SharedExecutorInput<unknown>
): Promise<{
  sharedJobId: string | null
  sharedActionAttemptId: string | null
  requiresApproval: boolean
}> {
  const startedAt = new Date().toISOString()
  const actionDecisionStatus = input.action?.proposalDecisionStatus || 'proposed'
  const requiresApproval = Boolean(input.action) && actionDecisionStatus === 'proposed'
  const contextSnapshotId = await createSharedContextSnapshot({
    orgId: input.orgId,
    propertyId: input.propertyId,
    domain: input.domain,
    subjectId: input.subjectId,
    dedupeKey: input.dedupeKey,
    capturedBy: input.capturedBy,
  })
  const insert: TablesInsert<'shared_jobs'> = {
    org_id: input.orgId,
    property_id: input.propertyId ?? null,
    domain: input.domain,
    subject_type: input.subjectType,
    subject_id: input.subjectId ?? null,
    lifecycle_status: requiresApproval ? 'queued' : 'running',
    status_reason: requiresApproval ? 'approval_required' : null,
    dedupe_key: input.dedupeKey ?? null,
    payload: toJson(input.payload),
    context_snapshot_id: contextSnapshotId,
    attempt_count: 1,
    max_attempts: input.maxAttempts ?? 3,
    queued_at: startedAt,
    started_at: requiresApproval ? null : startedAt,
    updated_at: startedAt,
  }

  let sharedJobId: string | null = null
  let sharedActionAttemptId: string | null = null
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase.from('shared_jobs').insert(insert).select('id').single()
    if (error) {
      console.error('[shared_executor] failed to start shared job', {
        domain: input.domain,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        error,
      })
    } else {
      sharedJobId = data.id
      if (input.action) {
        const actionInsert: TablesInsert<'shared_action_attempts'> = {
          job_id: sharedJobId,
          org_id: input.orgId,
          property_id: input.propertyId ?? null,
          action_type: input.action.actionType,
          lifecycle_status: requiresApproval ? 'queued' : 'running',
          proposal_decision_status: actionDecisionStatus,
          execution_status: requiresApproval ? 'pending_approval' : 'executing',
          request_payload: toJson(input.action.requestPayload),
          execution_payload: toJson(input.action.executionPayload || input.payload),
          confidence_score: input.action.confidenceScore ?? null,
          policy_reason: input.action.policyReason ?? null,
          requested_by: input.requestedBy ?? null,
          proposed_at: startedAt,
          updated_at: startedAt,
        }
        const { data: actionData, error: actionError } = await supabase
          .from('shared_action_attempts')
          .insert(actionInsert)
          .select('id')
          .single()
        if (actionError) {
          console.error('[shared_executor] failed to create shared action attempt', {
            domain: input.domain,
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            error: actionError,
          })
        } else {
          sharedActionAttemptId = actionData.id
        }
      }
    }
  } catch (error) {
    console.error('[shared_executor] unexpected start failure', { error })
  }

  return { sharedJobId, sharedActionAttemptId, requiresApproval }
}

async function beginSharedExecution(input: ExistingSharedExecutionInput<unknown>): Promise<void> {
  const nowIso = new Date().toISOString()
  const supabase = createServiceClient()
  let nextAttemptCount: number | undefined

  if (input.incrementAttemptCount) {
    const { data } = await supabase.from('shared_jobs').select('attempt_count').eq('id', input.sharedJobId).single()
    nextAttemptCount = Number(data?.attempt_count || 0) + 1
  }

  await finalizeSharedJob(input.sharedJobId, {
    lifecycle_status: 'running',
    status_reason: input.statusReason ?? 'executing',
    started_at: nowIso,
    finished_at: null,
    error_message: null,
    attempt_count: nextAttemptCount,
    updated_at: nowIso,
  })

  if (input.sharedActionAttemptId) {
    await finalizeSharedActionAttempt(input.sharedActionAttemptId, {
      lifecycle_status: 'running',
      execution_status: 'executing',
      error_message: null,
      executed_at: null,
      reversed_at: null,
      updated_at: nowIso,
    })
  }
}

export async function executeExistingSharedJob<T>(input: ExistingSharedExecutionInput<T>): Promise<T> {
  await beginSharedExecution(input)

  try {
    const result = await input.execute()
    const completedAt = new Date().toISOString()
    await finalizeSharedJob(input.sharedJobId, {
      lifecycle_status: 'succeeded',
      status_reason: 'completed',
      finished_at: completedAt,
      updated_at: completedAt,
    })
    if (input.sharedActionAttemptId) {
      await finalizeSharedActionAttempt(input.sharedActionAttemptId, {
        lifecycle_status: 'succeeded',
        execution_status: 'executed',
        execution_result: toJsonFromUnknown(result),
        executed_at: completedAt,
        error_message: null,
        updated_at: completedAt,
      })
    }
    return result
  } catch (error) {
    const failedAt = new Date().toISOString()
    await finalizeSharedJob(input.sharedJobId, {
      lifecycle_status: 'failed',
      status_reason: 'execution_failed',
      error_message: error instanceof Error ? error.message : 'Execution failed',
      finished_at: failedAt,
      updated_at: failedAt,
    })
    if (input.sharedActionAttemptId) {
      await finalizeSharedActionAttempt(input.sharedActionAttemptId, {
        lifecycle_status: 'failed',
        execution_status: 'failed',
        error_message: error instanceof Error ? error.message : 'Execution failed',
        updated_at: failedAt,
      })
    }
    throw error
  }
}

export async function runSharedExecutorJob<T>(input: SharedExecutorInput<T>): Promise<T> {
  const { sharedJobId, sharedActionAttemptId, requiresApproval } = await startSharedExecutorJob(input)

  if (requiresApproval) {
    throw new SharedExecutorApprovalRequiredError(
      'Action requires approval before execution.',
      sharedJobId,
      sharedActionAttemptId
    )
  }

  if (!sharedJobId) {
    return input.execute()
  }

  return executeExistingSharedJob({
    sharedJobId,
    sharedActionAttemptId,
    execute: input.execute,
  })
}

