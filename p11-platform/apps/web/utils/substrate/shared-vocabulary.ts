export type SharedLifecycleStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'retrying'
  | 'cancelled'

export type SharedProposalDecisionStatus = 'proposed' | 'approved' | 'denied' | 'modified'

export type SharedExecutionStatus =
  | 'queued'
  | 'pending_approval'
  | 'approved_pending_execution'
  | 'executing'
  | 'executed'
  | 'failed'
  | 'cancelled'
  | 'reversed'

export type SharedOutcomeStatus = 'unknown' | 'positive' | 'neutral' | 'negative'

export const SHARED_STATE_SEMANTICS = {
  lifecycle: {
    queued: 'Accepted for execution but not started yet.',
    running: 'Actively processing now.',
    succeeded: 'Finished successfully.',
    failed: 'Reached terminal failure and needs intervention or retry policy.',
    retrying: 'Transient failure path; retry attempts are in progress.',
    cancelled: 'Stopped intentionally by policy or operator action.',
  },
  proposalDecision: {
    proposed: 'Suggested action awaiting review path.',
    approved: 'Explicitly approved for execution.',
    denied: 'Explicitly rejected and will not execute.',
    modified: 'Approved with required changes to original proposal.',
  },
  execution: {
    queued: 'Execution is queued but not yet started.',
    pending_approval: 'Execution is blocked pending human approval.',
    approved_pending_execution: 'Execution was approved and is awaiting dispatch.',
    executing: 'Execution call is currently in-flight.',
    executed: 'Execution completed and mutation was attempted.',
    failed: 'Execution attempt failed and may need replay or operator review.',
    cancelled: 'Execution was intentionally cancelled before mutation.',
    reversed: 'Compensating/rollback action executed.',
  },
  outcome: {
    unknown: 'Outcome has not been measured yet.',
    positive: 'Outcome improved target KPI(s).',
    neutral: 'Outcome had no material KPI change.',
    negative: 'Outcome regressed KPI(s) or introduced risk.',
  },
} as const

type DeriveOptions = {
  hasWarnings?: boolean
}

export type SharedLifecycleDerivation = {
  status: SharedLifecycleStatus
  sourceStatus: string
  isDegraded: boolean
}

const LIFECYCLE_ALIAS_TO_CANONICAL: Record<string, SharedLifecycleStatus> = {
  queued: 'queued',
  queue: 'queued',
  pending: 'queued',
  scheduled: 'queued',
  running: 'running',
  in_progress: 'running',
  processing: 'running',
  active: 'running',
  succeeded: 'succeeded',
  success: 'succeeded',
  complete: 'succeeded',
  completed: 'succeeded',
  sent: 'succeeded',
  failed: 'failed',
  failure: 'failed',
  error: 'failed',
  errored: 'failed',
  retrying: 'retrying',
  retry: 'retrying',
  cancelled: 'cancelled',
  canceled: 'cancelled',
}

export function deriveSharedLifecycleStatus(
  status: string | null | undefined,
  options?: DeriveOptions
): SharedLifecycleDerivation {
  const sourceStatus = (status || '').trim().toLowerCase()
  const canonicalStatus = LIFECYCLE_ALIAS_TO_CANONICAL[sourceStatus] || 'running'
  const hasWarnings = Boolean(options?.hasWarnings)
  const isDegraded = hasWarnings && canonicalStatus === 'succeeded'

  return {
    status: canonicalStatus,
    sourceStatus,
    isDegraded,
  }
}

