/**
 * ReviewFlow multifamily taxonomy (versioned).
 *
 * Single source of truth for how reviews are classified into journey stages,
 * issue domains, severity, risk classes, and policy classes. Every persisted
 * analysis records TAXONOMY_VERSION so classifications remain interpretable
 * as the taxonomy evolves.
 */

export const TAXONOMY_VERSION = 'multifamily-v1'

export const JOURNEY_STAGES = [
  'touring',
  'application',
  'move_in',
  'residency',
  'maintenance_request',
  'renewal',
  'move_out',
  'former_resident',
  'non_resident',
  'unknown',
] as const
export type JourneyStage = (typeof JOURNEY_STAGES)[number]

export const ISSUE_DOMAINS = [
  'maintenance',
  'management_staff',
  'leasing_experience',
  'noise',
  'safety_security',
  'pests',
  'habitability',
  'cleanliness',
  'amenities',
  'parking',
  'billing_fees',
  'deposits',
  'communication',
  'pet_policy',
  'neighbors_community',
  'value_pricing',
  'praise_general',
  'other',
] as const
export type IssueDomain = (typeof ISSUE_DOMAINS)[number]

export const SEVERITY_LEVELS = ['low', 'medium', 'high', 'critical'] as const
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number]

/**
 * Risk classes drive prioritization and SLA. Ordered from least to most risky.
 */
export const RISK_CLASSES = ['routine', 'reputational', 'operational', 'legal_regulatory'] as const
export type RiskClass = (typeof RISK_CLASSES)[number]

/**
 * Policy classes drive the response-governance gate. Anything other than
 * 'standard' requires human review and can never be auto-action eligible.
 */
export const POLICY_CLASSES = [
  'standard',
  'fair_housing',
  'discrimination',
  'accessibility',
  'safety',
  'legal_threat',
  'privacy',
  'habitability',
  'employee_accusation',
  'compensation_liability',
] as const
export type PolicyClass = (typeof POLICY_CLASSES)[number]

export const SENSITIVE_POLICY_CLASSES: ReadonlySet<PolicyClass> = new Set(
  POLICY_CLASSES.filter((cls) => cls !== 'standard')
)

/** Default SLA hours by priority, used when creating reputation cases. */
export const SLA_HOURS_BY_PRIORITY: Record<'low' | 'medium' | 'high' | 'urgent', number> = {
  low: 7 * 24,
  medium: 72,
  high: 24,
  urgent: 4,
}

export type CasePriority = keyof typeof SLA_HOURS_BY_PRIORITY

export function derivePriority(input: {
  isUrgent: boolean
  sentiment: string | null
  severity?: SeverityLevel | null
  riskClass?: RiskClass | null
}): CasePriority {
  if (input.isUrgent || input.severity === 'critical' || input.riskClass === 'legal_regulatory') {
    return 'urgent'
  }
  if (input.severity === 'high' || input.sentiment === 'negative') {
    return 'high'
  }
  if (input.severity === 'medium' || input.sentiment === 'neutral') {
    return 'medium'
  }
  return 'low'
}

export function slaDueAtForPriority(priority: CasePriority, from = new Date()): string {
  const hours = SLA_HOURS_BY_PRIORITY[priority]
  return new Date(from.getTime() + hours * 60 * 60 * 1000).toISOString()
}

export function isJourneyStage(value: unknown): value is JourneyStage {
  return typeof value === 'string' && (JOURNEY_STAGES as readonly string[]).includes(value)
}

export function isIssueDomain(value: unknown): value is IssueDomain {
  return typeof value === 'string' && (ISSUE_DOMAINS as readonly string[]).includes(value)
}

export function isPolicyClass(value: unknown): value is PolicyClass {
  return typeof value === 'string' && (POLICY_CLASSES as readonly string[]).includes(value)
}

export function isRiskClass(value: unknown): value is RiskClass {
  return typeof value === 'string' && (RISK_CLASSES as readonly string[]).includes(value)
}
