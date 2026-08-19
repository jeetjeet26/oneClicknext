export const FORGESTUDIO_AUTONOMY_POLICY_VERSION = 'forgestudio.autonomy.2026-08-13'

export type ForgeStudioAutonomyMode = 'recommendation' | 'supervised' | 'bounded'
export type ForgeStudioActionClass =
  | 'campaign_theme'
  | 'calendar_gap'
  | 'creative_rotation'
  | 'approved_asset_reuse'
  | 'cadence_reschedule'
  | 'sensitive_claim'
  | 'targeting_change'
  | 'crisis_content'
  | 'brand_system_change'

const BOUNDED_ACTION_CLASSES = new Set<ForgeStudioActionClass>([
  'calendar_gap',
  'creative_rotation',
  'approved_asset_reuse',
  'cadence_reschedule',
])

export type AutonomyEvidence = {
  completedEvaluationCycles: number
  measuredKpiLift: number | null
  attributionCoverage: number
  policyIncidentRate: number
  reversalRate: number
  operatorOverrideRate: number
  contextFresh: boolean
  rightsCleared: boolean
  providerHealthy: boolean
}

export function evaluateForgeStudioAutonomy(input: {
  requestedMode: ForgeStudioAutonomyMode
  actionClass: ForgeStudioActionClass
  evidence: AutonomyEvidence
}): {
  allowed: boolean
  effectiveMode: ForgeStudioAutonomyMode
  reasons: string[]
  policyVersion: string
} {
  const reasons: string[] = []
  const { evidence } = input

  if (!evidence.contextFresh) reasons.push('context_not_fresh')
  if (!evidence.rightsCleared) reasons.push('asset_rights_not_cleared')
  if (!evidence.providerHealthy) reasons.push('provider_degraded')

  if (input.requestedMode === 'recommendation') {
    return {
      allowed: reasons.length === 0,
      effectiveMode: 'recommendation',
      reasons,
      policyVersion: FORGESTUDIO_AUTONOMY_POLICY_VERSION,
    }
  }

  if (evidence.completedEvaluationCycles < 2) reasons.push('insufficient_evaluation_cycles')
  if (evidence.measuredKpiLift == null || evidence.measuredKpiLift < 0) {
    reasons.push('kpi_lift_not_proven')
  }
  if (evidence.attributionCoverage < 0.8) reasons.push('attribution_coverage_too_low')
  if (evidence.policyIncidentRate > 0.01) reasons.push('policy_incident_rate_too_high')

  if (input.requestedMode === 'supervised') {
    return {
      allowed: reasons.length === 0,
      effectiveMode: reasons.length === 0 ? 'supervised' : 'recommendation',
      reasons,
      policyVersion: FORGESTUDIO_AUTONOMY_POLICY_VERSION,
    }
  }

  if (!BOUNDED_ACTION_CLASSES.has(input.actionClass)) reasons.push('action_class_requires_human_approval')
  if (evidence.completedEvaluationCycles < 4) reasons.push('bounded_mode_requires_four_cycles')
  if ((evidence.measuredKpiLift ?? 0) < 0.05) reasons.push('bounded_mode_requires_five_percent_lift')
  if (evidence.attributionCoverage < 0.9) reasons.push('bounded_attribution_coverage_too_low')
  if (evidence.policyIncidentRate > 0.002) reasons.push('bounded_policy_incident_rate_too_high')
  if (evidence.reversalRate > 0.01) reasons.push('reversal_rate_too_high')
  if (evidence.operatorOverrideRate > 0.1) reasons.push('operator_override_rate_too_high')

  return {
    allowed: reasons.length === 0,
    effectiveMode: reasons.length === 0 ? 'bounded' : 'recommendation',
    reasons,
    policyVersion: FORGESTUDIO_AUTONOMY_POLICY_VERSION,
  }
}
