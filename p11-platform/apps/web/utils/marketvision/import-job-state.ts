export type ImportJobState = 'pending' | 'running' | 'complete' | 'partial' | 'failed' | 'unknown'

type ImportJobRecord = { status?: string | null; error_message?: string | null; recovery_version?: number | null; lease_expires_at?: string | null }

export function deriveImportJobState(job: ImportJobRecord): ImportJobState {
  const status = job.status?.trim().toLowerCase()
  if (status === 'pending' || status === 'queued') return 'pending'
  if (status === 'running' || status === 'processing' || status === 'retrying') return 'running'
  if (status === 'failed' || status === 'cancelled' || status === 'canceled') return 'failed'
  if (status === 'partial') return 'partial'
  if (status === 'complete' || status === 'completed' || status === 'success' || status === 'succeeded') {
    return job.error_message?.trim() ? 'partial' : 'complete'
  }
  return 'unknown'
}

export function normalizeImportJobRecord<T extends ImportJobRecord>(job: T) {
  const recoveryNeeded = job.status === 'running' && job.recovery_version === 1 && Boolean(job.lease_expires_at) && Date.parse(job.lease_expires_at!) < Date.now()
  const importState = recoveryNeeded ? 'pending' : deriveImportJobState(job)
  return {
    ...job, import_state: importState, recovery_needed: recoveryNeeded,
    ...(recoveryNeeded ? { current_step: 'Waiting for the recovery worker; saved progress is retained' } : {}),
    has_warnings: Boolean(job.error_message?.trim()) || importState === 'partial',
    is_terminal: ['complete', 'partial', 'failed'].includes(importState),
  }
}
