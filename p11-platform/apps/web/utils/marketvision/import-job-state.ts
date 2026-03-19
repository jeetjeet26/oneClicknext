import { deriveSharedLifecycleStatus } from '@/utils/substrate/shared-vocabulary'

export type ImportJobState = 'pending' | 'running' | 'complete' | 'partial' | 'failed'

type ImportJobRecord = {
  status?: string | null
  error_message?: string | null
}

export function deriveImportJobState(job: ImportJobRecord): ImportJobState {
  const normalizedStatus = (job.status || '').trim().toLowerCase()
  const hasErrorMessage = Boolean(job.error_message && job.error_message.trim().length > 0)

  if (normalizedStatus === 'partial') {
    return 'partial'
  }

  const shared = deriveSharedLifecycleStatus(normalizedStatus, { hasWarnings: hasErrorMessage })

  if (shared.status === 'queued') return 'pending'
  if (shared.status === 'running' || shared.status === 'retrying') {
    return hasErrorMessage ? 'partial' : 'running'
  }
  if (shared.status === 'failed' || shared.status === 'cancelled') return 'failed'
  if (shared.status === 'succeeded') return shared.isDegraded ? 'partial' : 'complete'

  return hasErrorMessage ? 'partial' : 'running'
}

export function normalizeImportJobRecord<T extends ImportJobRecord>(job: T) {
  const importState = deriveImportJobState(job)
  return {
    ...job,
    import_state: importState,
    has_warnings: importState === 'partial',
    is_terminal: importState === 'complete' || importState === 'partial' || importState === 'failed',
  }
}
