import { createServiceClient } from '@/utils/supabase/admin'
import { executeExistingSharedJob } from '@/utils/services/shared-executor'
import { getAppBaseUrl } from '@/utils/services/runtime-config'

type DispatchMode = 'resume' | 'replay'

export class SharedDispatchError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 500) {
    super(message)
    this.name = 'SharedDispatchError'
    this.statusCode = statusCode
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

async function dispatchForgeStudioPublishAction(input: {
  actionAttemptId: string
  sharedJobId: string
  executionPayload: Record<string, unknown>
}) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    throw new SharedDispatchError('CRON_SECRET is required to resume shared execution internally', 500)
  }

  const draftId = typeof input.executionPayload.draftId === 'string' ? input.executionPayload.draftId : null
  const connectionIds = Array.isArray(input.executionPayload.connectionIds)
    ? input.executionPayload.connectionIds.filter(
        (value): value is string => typeof value === 'string' && value.length > 0
      )
    : []

  if (!draftId || connectionIds.length === 0) {
    throw new SharedDispatchError('Shared publish action is missing draftId or connectionIds', 400)
  }

  const response = await fetch(`${getAppBaseUrl()}/api/forgestudio/social/publish`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      draftId,
      connectionIds,
      sharedJobId: input.sharedJobId,
      sharedActionAttemptId: input.actionAttemptId,
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new SharedDispatchError(
      typeof payload?.error === 'string' ? payload.error : 'Shared dispatch failed',
      response.status
    )
  }

  return payload
}

export async function resumeSharedActionAttempt(
  actionAttemptId: string,
  mode: DispatchMode = 'resume'
) {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('shared_action_attempts')
    .select(
      `
        id,
        job_id,
        property_id,
        action_type,
        proposal_decision_status,
        lifecycle_status,
        execution_status,
        execution_payload,
        shared_jobs!inner (
          id,
          domain
        )
      `
    )
    .eq('id', actionAttemptId)
    .single()

  if (error || !data) {
    throw new SharedDispatchError('Shared action attempt not found', 404)
  }

  const sharedJob = Array.isArray(data.shared_jobs) ? data.shared_jobs[0] : data.shared_jobs
  const sharedJobId = typeof sharedJob?.id === 'string' ? sharedJob.id : null
  const domain = typeof sharedJob?.domain === 'string' ? sharedJob.domain : null

  if (!sharedJobId || !domain) {
    throw new SharedDispatchError('Shared action attempt is missing job context', 409)
  }

  if (mode === 'resume' && !['approved', 'modified'].includes(data.proposal_decision_status || '')) {
    throw new SharedDispatchError('Only approved or modified actions can be resumed', 409)
  }

  if (
    mode === 'replay' &&
    !['failed', 'cancelled', 'approved_pending_execution', 'queued'].includes(data.execution_status || '')
  ) {
    throw new SharedDispatchError('Only failed or queued actions can be replayed', 409)
  }

  const dispatch = async () => {
    switch (`${domain}:${data.action_type}`) {
      case 'forgestudio.publish:publish_social_content':
        return dispatchForgeStudioPublishAction({
          actionAttemptId: data.id,
          sharedJobId,
          executionPayload: toRecord(data.execution_payload),
        })
      default:
        throw new SharedDispatchError(
          `No shared dispatcher is registered for ${domain}:${data.action_type}`,
          501
        )
    }
  }

  return executeExistingSharedJob({
    sharedJobId,
    sharedActionAttemptId: data.id,
    execute: dispatch,
    statusReason: mode === 'replay' ? 'replaying' : 'approved_for_execution',
    incrementAttemptCount: mode === 'replay',
  })
}
