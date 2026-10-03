import { createServiceClient } from '@/utils/supabase/admin'
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/types/supabase'
import { deriveSharedLifecycleStatus, type SharedLifecycleStatus } from '@/utils/substrate/shared-vocabulary'

export type CronJobRunRow = Tables<'cron_job_runs'>

export function toSharedLifecycleFromCronStatus(
  status: string | null | undefined
): SharedLifecycleStatus {
  return deriveSharedLifecycleStatus(status).status
}

type CronRunSummary = Record<string, unknown>

export function cronStatusFromOutcomes(result: {
  succeeded: number
  failed: number
  errors?: string[]
}): 'success' | 'partial' | 'failed' {
  if (result.failed > 0 || (result.errors?.length ?? 0) > 0) {
    return result.succeeded > 0 ? 'partial' : 'failed'
  }
  return 'success'
}

export type CronRunHandle = {
  id: string
  jobName: string
  startedAtMs: number
}

type StartCronJobRunInput = {
  jobName: string
  requestId?: string | null
  triggerSource?: string
}

type FinishCronJobRunInput = {
  status: 'success' | 'partial' | 'failed'
  summary?: CronRunSummary
  error?: string | null
}

function toJson(value: CronRunSummary | undefined): Json | undefined {
  if (!value) return undefined
  return value as Json
}

export async function startCronJobRun({
  jobName,
  requestId,
  triggerSource = 'cron',
}: StartCronJobRunInput): Promise<CronRunHandle | null> {
  try {
    const supabase = createServiceClient()
    const insert: TablesInsert<'cron_job_runs'> = {
      job_name: jobName,
      request_id: requestId ?? null,
      status: 'running',
      trigger_source: triggerSource,
    }

    const { data, error } = await supabase
      .from('cron_job_runs')
      .insert(insert)
      .select('id')
      .single()

    if (error || !data) {
      console.error('[cron_job_runs] failed to insert start record', { jobName, error })
      return null
    }

    return {
      id: data.id,
      jobName,
      startedAtMs: Date.now(),
    }
  } catch (error) {
    console.error('[cron_job_runs] failed to start run', { jobName, error })
    return null
  }
}

export async function finishCronJobRun(
  run: CronRunHandle | null,
  { status, summary, error }: FinishCronJobRunInput
): Promise<boolean> {
  if (!run) return false

  try {
    const supabase = createServiceClient()
    const update: TablesUpdate<'cron_job_runs'> = {
      completed_at: new Date().toISOString(),
      duration_ms: Math.max(Date.now() - run.startedAtMs, 0),
      error: error ?? null,
      status,
      summary: toJson(summary),
    }

    const { data: saved, error: updateError } = await supabase
      .from('cron_job_runs')
      .update(update)
      .eq('id', run.id).eq('status','running').select('id').maybeSingle()

    if (updateError || !saved) {
      console.error('[cron_job_runs] failed to finish run', {
        runId: run.id,
        jobName: run.jobName,
        error: updateError,
      })
      return false
    }
    return true
  } catch (finishError) {
    console.error('[cron_job_runs] failed to finalize run', {
      runId: run.id,
      jobName: run.jobName,
      error: finishError,
    })
    return false
  }
}

type ListRecentCronJobRunsInput = {
  limit?: number
  jobName?: string | null
  status?: string | null
}

export async function listRecentCronJobRuns({
  limit = 20,
  jobName,
  status,
}: ListRecentCronJobRunsInput): Promise<CronJobRunRow[]> {
  const supabase = createServiceClient()

  let query = supabase
    .from('cron_job_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100))

  if (jobName) {
    query = query.eq('job_name', jobName)
  }

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return data ?? []
}

export async function confirmCronJobRun(run:CronRunHandle|null,input:FinishCronJobRunInput):Promise<void> {
  if(!await finishCronJobRun(run,input)) throw new Error('Scheduled result could not be saved')
}
