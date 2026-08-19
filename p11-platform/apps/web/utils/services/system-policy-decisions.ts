import type { Json, Tables, TablesInsert } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

export type SystemPolicyVerdict = 'approved' | 'denied' | 'modified'

export type SystemPolicyDecisionInput = {
  orgId: string
  propertyId?: string | null
  jobId?: string | null
  actionAttemptId?: string | null
  policyName: string
  policyVersion: string
  verdict: SystemPolicyVerdict
  reasonCode: string
  confidenceScore?: number | null
  source?: unknown
  payload?: Record<string, unknown>
}

export class SystemPolicyDecisionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SystemPolicyDecisionError'
  }
}

export async function recordSystemPolicyDecision(
  input: SystemPolicyDecisionInput
): Promise<Tables<'shared_policy_decisions'>> {
  const sourceHash =
    input.source === undefined ? null : hashSiteForgeContent(input.source)
  const insert: TablesInsert<'shared_policy_decisions'> = {
    org_id: input.orgId,
    property_id: input.propertyId ?? null,
    job_id: input.jobId ?? null,
    action_attempt_id: input.actionAttemptId ?? null,
    policy_name: input.policyName,
    policy_version: input.policyVersion,
    decision_status: input.verdict,
    decision_reason: input.reasonCode,
    confidence_score: input.confidenceScore ?? null,
    decision_payload: (input.payload || {}) as Json,
    actor_type: 'system_policy',
    enforcement_outcome:
      input.verdict === 'approved'
        ? 'allow'
        : input.verdict === 'denied'
          ? 'deny'
          : 'require_approval',
    evaluator: 'siteforge-system-policy',
    source_hash: sourceHash,
    decided_at: new Date().toISOString(),
  }
  const service = createServiceClient()
  let lookup = service
    .from('shared_policy_decisions')
    .select('*')
    .eq('org_id', input.orgId)
    .eq('policy_name', input.policyName)
    .eq('policy_version', input.policyVersion)
    .eq('actor_type', 'system_policy')
  lookup = input.actionAttemptId
    ? lookup.eq('action_attempt_id', input.actionAttemptId)
    : lookup.is('action_attempt_id', null)
  lookup = sourceHash
    ? lookup.eq('source_hash', sourceHash)
    : lookup.is('source_hash', null)
  const existing = await lookup
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing.error) {
    throw new SystemPolicyDecisionError(
      `Failed to reconcile system policy decision: ${existing.error.message}`
    )
  }
  if (existing.data) {
    if (
      existing.data.decision_status !== input.verdict ||
      existing.data.decision_reason !== input.reasonCode
    ) {
      throw new SystemPolicyDecisionError(
        'System policy source was already decided with a different verdict'
      )
    }
    return existing.data
  }
  const created = await service
    .from('shared_policy_decisions')
    .insert(insert)
    .select('*')
    .single()
  if (created.error || !created.data) {
    throw new SystemPolicyDecisionError(
      `Failed to record system policy decision: ${
        created.error?.message || 'unknown error'
      }`
    )
  }
  return created.data
}
