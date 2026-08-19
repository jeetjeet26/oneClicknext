import type { Json, Tables, TablesInsert } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'

export type ExecutionBudgetLimits = {
  maxCostCents?: number
  maxInputTokens?: number
  maxOutputTokens?: number
  maxModelAttempts?: number
  maxBrowserRuns?: number
  maxProviderCalls?: number
  maxRepairOperations?: number
  maxWallSeconds?: number
}

export type ExecutionBudgetReservation = {
  idempotencyKey: string
  costCents?: number
  inputTokens?: number
  outputTokens?: number
  modelAttempts?: number
  browserRuns?: number
  providerCalls?: number
  repairOperations?: number
}

export type ExecutionBudgetSettlement = {
  idempotencyKey: string
  reservedCostCents?: number
  usedCostCents?: number
  reservedInputTokens?: number
  usedInputTokens?: number
  reservedOutputTokens?: number
  usedOutputTokens?: number
}

export class ExecutionBudgetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutionBudgetError'
  }
}

function nonNegative(value: number | undefined, field: string) {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new ExecutionBudgetError(`${field} must be a non-negative number`)
  }
  return value
}

function integer(value: number | undefined, field: string) {
  const checked = nonNegative(value, field)
  if (checked !== undefined && !Number.isInteger(checked)) {
    throw new ExecutionBudgetError(`${field} must be an integer`)
  }
  return checked
}

export async function createExecutionBudget(input: {
  orgId: string
  propertyId?: string | null
  websiteId?: string | null
  jobId?: string | null
  policyVersion: string
  limits?: ExecutionBudgetLimits
  modelPolicy?: Record<string, unknown>
  metadata?: Record<string, unknown>
  startedAt?: string
}): Promise<Tables<'shared_execution_budgets'>> {
  const limits = input.limits || {}
  const startedAt = input.startedAt || new Date().toISOString()
  const maxWallSeconds = integer(limits.maxWallSeconds, 'maxWallSeconds') ?? 21_600
  const insert: TablesInsert<'shared_execution_budgets'> = {
    org_id: input.orgId,
    property_id: input.propertyId ?? null,
    website_id: input.websiteId ?? null,
    job_id: input.jobId ?? null,
    policy_version: input.policyVersion,
    max_cost_cents: integer(limits.maxCostCents, 'maxCostCents') ?? 80_000,
    max_input_tokens:
      integer(limits.maxInputTokens, 'maxInputTokens') ?? 2_000_000,
    max_output_tokens:
      integer(limits.maxOutputTokens, 'maxOutputTokens') ?? 500_000,
    max_model_attempts:
      integer(limits.maxModelAttempts, 'maxModelAttempts') ?? 40,
    max_browser_runs:
      integer(limits.maxBrowserRuns, 'maxBrowserRuns') ?? 12,
    max_provider_calls:
      integer(limits.maxProviderCalls, 'maxProviderCalls') ?? 100,
    max_repair_operations:
      integer(limits.maxRepairOperations, 'maxRepairOperations') ?? 24,
    max_wall_seconds: maxWallSeconds,
    started_at: startedAt,
    deadline_at: new Date(
      new Date(startedAt).getTime() + maxWallSeconds * 1_000
    ).toISOString(),
    model_policy: (input.modelPolicy || {}) as Json,
    metadata: (input.metadata || {}) as Json,
  }
  const service = createServiceClient()
  const { data, error } = await service
    .from('shared_execution_budgets')
    .insert(insert)
    .select('*')
    .single()
  if (error || !data) {
    throw new ExecutionBudgetError(
      `Failed to create execution budget: ${error?.message || 'unknown error'}`
    )
  }
  return data
}

export async function reserveExecutionBudget(
  budgetId: string,
  reservation: ExecutionBudgetReservation
): Promise<Tables<'shared_execution_budgets'>> {
  if (!reservation.idempotencyKey.trim()) {
    throw new ExecutionBudgetError('Budget idempotency key is required')
  }
  const service = createServiceClient()
  const { data, error } = await service.rpc('reserve_shared_execution_budget_v2', {
    p_budget_id: budgetId,
    p_idempotency_key: reservation.idempotencyKey,
    p_cost_cents: integer(reservation.costCents, 'costCents') ?? 0,
    p_input_tokens: integer(reservation.inputTokens, 'inputTokens') ?? 0,
    p_output_tokens: integer(reservation.outputTokens, 'outputTokens') ?? 0,
    p_model_attempts: integer(reservation.modelAttempts, 'modelAttempts') ?? 0,
    p_browser_runs: integer(reservation.browserRuns, 'browserRuns') ?? 0,
    p_provider_calls: integer(reservation.providerCalls, 'providerCalls') ?? 0,
    p_repair_operations:
      integer(reservation.repairOperations, 'repairOperations') ?? 0,
  })
  if (error || !data) {
    throw new ExecutionBudgetError(
      `Execution budget reservation failed: ${error?.message || 'unknown error'}`
    )
  }
  return data
}

export async function settleExecutionBudget(
  budgetId: string,
  settlement: ExecutionBudgetSettlement
): Promise<Tables<'shared_execution_budgets'>> {
  if (!settlement.idempotencyKey.trim()) {
    throw new ExecutionBudgetError('Budget idempotency key is required')
  }
  const service = createServiceClient()
  const { data, error } = await service.rpc('settle_shared_execution_budget_v2', {
    p_budget_id: budgetId,
    p_idempotency_key: settlement.idempotencyKey,
    p_reserved_cost_cents:
      integer(settlement.reservedCostCents, 'reservedCostCents') ?? 0,
    p_used_cost_cents:
      integer(settlement.usedCostCents, 'usedCostCents') ?? 0,
    p_reserved_input_tokens:
      integer(settlement.reservedInputTokens, 'reservedInputTokens') ?? 0,
    p_used_input_tokens:
      integer(settlement.usedInputTokens, 'usedInputTokens') ?? 0,
    p_reserved_output_tokens:
      integer(settlement.reservedOutputTokens, 'reservedOutputTokens') ?? 0,
    p_used_output_tokens:
      integer(settlement.usedOutputTokens, 'usedOutputTokens') ?? 0,
  })
  if (error || !data) {
    throw new ExecutionBudgetError(
      `Execution budget settlement failed: ${error?.message || 'unknown error'}`
    )
  }
  return data
}

export async function closeExecutionBudget(
  budgetId: string,
  status: 'closed' | 'cancelled' = 'closed'
) {
  const service = createServiceClient()
  const { data, error } = await service
    .from('shared_execution_budgets')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', budgetId)
    .eq('status', 'active')
    .select('*')
    .maybeSingle()
  if (error) {
    throw new ExecutionBudgetError(
      `Failed to close execution budget: ${error.message}`
    )
  }
  return data
}
