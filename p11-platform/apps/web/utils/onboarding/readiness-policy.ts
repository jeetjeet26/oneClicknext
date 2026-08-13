export type ReadinessApprovalPolicy =
  | 'required'
  | 'manager_override'
  | 'advisory'

export const READINESS_DOMAIN_APPROVAL_POLICY: Record<
  string,
  ReadinessApprovalPolicy
> = {
  identityContact: 'required',
  brand: 'required',
  assets: 'required',
  legal: 'required',
  propertyFacts: 'manager_override',
  units: 'manager_override',
  integrations: 'manager_override',
  neighborhood: 'advisory',
}

export type ReadinessConflict = {
  domain: string
  reasons: string[]
  sourceIds: string[]
  approvalPolicy: ReadinessApprovalPolicy
}

export type ReadinessApprovalEligibility = {
  canApprove: boolean
  requiresManagerOverride: boolean
  hardBlockers: ReadinessConflict[]
  overrideableConflicts: ReadinessConflict[]
}

export function readinessApprovalPolicyForDomain(
  domain: string
): ReadinessApprovalPolicy {
  return READINESS_DOMAIN_APPROVAL_POLICY[domain] || 'required'
}

function parseConflict(value: unknown): ReadinessConflict | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const conflict = value as Record<string, unknown>
  if (typeof conflict.domain !== 'string') return null
  const approvalPolicy =
    conflict.approvalPolicy === 'required' ||
    conflict.approvalPolicy === 'manager_override' ||
    conflict.approvalPolicy === 'advisory'
      ? conflict.approvalPolicy
      : readinessApprovalPolicyForDomain(conflict.domain)
  return {
    domain: conflict.domain,
    reasons: Array.isArray(conflict.reasons)
      ? conflict.reasons.filter(
          (reason): reason is string => typeof reason === 'string'
        )
      : [],
    sourceIds: Array.isArray(conflict.sourceIds)
      ? conflict.sourceIds.filter(
          (sourceId): sourceId is string => typeof sourceId === 'string'
        )
      : [],
    approvalPolicy,
  }
}

export function evaluateReadinessApproval(input: {
  status: string
  unresolved_conflicts: unknown
}): ReadinessApprovalEligibility {
  const conflicts = Array.isArray(input.unresolved_conflicts)
    ? input.unresolved_conflicts.flatMap((value) => {
        const parsed = parseConflict(value)
        return parsed ? [parsed] : []
      })
    : []
  const hardBlockers = conflicts.filter(
    (conflict) => conflict.approvalPolicy === 'required'
  )
  const overrideableConflicts = conflicts.filter(
    (conflict) => conflict.approvalPolicy === 'manager_override'
  )
  const readyWithoutOverride =
    input.status === 'ready' && conflicts.length === 0
  const canOverride =
    input.status === 'needs_review' &&
    hardBlockers.length === 0 &&
    overrideableConflicts.length > 0 &&
    conflicts.length === overrideableConflicts.length

  return {
    canApprove: readyWithoutOverride || canOverride,
    requiresManagerOverride: canOverride,
    hardBlockers,
    overrideableConflicts,
  }
}
