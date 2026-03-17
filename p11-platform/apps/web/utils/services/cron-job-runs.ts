import { createServiceClient } from '@/utils/supabase/admin'
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/types/supabase'

export type CronJobRunRow = Tables<'cron_job_runs'>

type CronRunSummary = Record<string, unknown>

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
  status: 'success' | 'failed'
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
): Promise<void> {
  if (!run) return

  try {
    const supabase = createServiceClient()
    const update: TablesUpdate<'cron_job_runs'> = {
      completed_at: new Date().toISOString(),
      duration_ms: Math.max(Date.now() - run.startedAtMs, 0),
      error: error ?? null,
      status,
      summary: toJson(summary),
    }

    const { error: updateError } = await supabase
      .from('cron_job_runs')
      .update(update)
      .eq('id', run.id)

    if (updateError) {
      console.error('[cron_job_runs] failed to finish run', {
        runId: run.id,
        jobName: run.jobName,
        error: updateError,
      })
    }
  } catch (finishError) {
    console.error('[cron_job_runs] failed to finalize run', {
      runId: run.id,
      jobName: run.jobName,
      error: finishError,
    })
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
