import { createServiceClient } from '@/utils/supabase/admin'
import type { TablesInsert } from '@/types/supabase'

export class SharedOutcomeError extends Error {
  statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'SharedOutcomeError'
    this.statusCode = statusCode
  }
}

export type RecordSharedOutcomeInput = {
  propertyId: string
  actionAttemptId: string
  kpiName: string
  baselineValue?: number | null
  observedValue?: number | null
  deltaValue?: number | null
  outcomeStatus?: 'unknown' | 'positive' | 'neutral' | 'negative'
  measurementWindowStart?: string | null
  measurementWindowEnd?: string | null
  attributionPayload?: Record<string, unknown>
}

export async function recordSharedOutcome(
  input: RecordSharedOutcomeInput,
  supabase = createServiceClient()
) {
  const kpiName = input.kpiName.trim()
  if (!kpiName) {
    throw new SharedOutcomeError('kpiName is required', 400)
  }

  const { data: actionAttempt, error: actionError } = await supabase
    .from('shared_action_attempts')
    .select('id, job_id, org_id, property_id')
    .eq('id', input.actionAttemptId)
    .eq('property_id', input.propertyId)
    .single()

  if (actionError || !actionAttempt) {
    throw new SharedOutcomeError('Shared action attempt not found', 404)
  }

  const insert: TablesInsert<'shared_experiment_outcomes'> = {
    org_id: actionAttempt.org_id,
    property_id: actionAttempt.property_id,
    job_id: actionAttempt.job_id,
    action_attempt_id: actionAttempt.id,
    kpi_name: kpiName,
    baseline_value: input.baselineValue ?? null,
    observed_value: input.observedValue ?? null,
    delta_value: input.deltaValue ?? null,
    outcome_status: input.outcomeStatus ?? 'unknown',
    measurement_window_start: input.measurementWindowStart ?? null,
    measurement_window_end: input.measurementWindowEnd ?? null,
    attribution_payload: (input.attributionPayload ?? {}) as TablesInsert<'shared_experiment_outcomes'>['attribution_payload'],
  }

  const { data, error } = await supabase
    .from('shared_experiment_outcomes')
    .insert(insert)
    .select('*')
    .single()

  if (error || !data) {
    throw new SharedOutcomeError('Failed to record shared outcome', 500)
  }

  return data
}
