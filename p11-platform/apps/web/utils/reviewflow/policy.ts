/**
 * ReviewFlow policy engine.
 *
 * Deterministic rules evaluated over review text and structured analysis.
 * These rules are the floor, not the ceiling: the model-assisted analysis can
 * escalate a review into a sensitive policy class, but deterministic matches
 * can never be downgraded by the model. Sensitive classes always require
 * manager review and are never auto-action eligible.
 */

import {
  SENSITIVE_POLICY_CLASSES,
  type PolicyClass,
  type RiskClass,
} from '@/utils/reviewflow/taxonomy'

export const POLICY_ENGINE_VERSION = 'reviewflow-policy-v1'

export type PolicyFlag = {
  policyClass: PolicyClass
  rule: string
  matchedText: string
}

export type PolicyEvaluation = {
  policyVersion: string
  policyClass: PolicyClass
  flags: PolicyFlag[]
  requiresHumanReview: boolean
  autoActionEligible: boolean
  reasons: string[]
}

type PatternRule = {
  policyClass: PolicyClass
  rule: string
  pattern: RegExp
}

const PATTERN_RULES: PatternRule[] = [
  {
    policyClass: 'fair_housing',
    rule: 'protected_class_language',
    pattern:
      /\b(race|racist|racial|religion|religious|national origin|immigrant|familial status|section 8|housing voucher|because (?:i am|i'm|we are|we're) (?:black|white|asian|hispanic|latino|muslim|jewish|christian|gay|trans|disabled|pregnant))\b/i,
  },
  {
    policyClass: 'discrimination',
    rule: 'discrimination_claim',
    pattern: /\b(discriminat\w+|profil(?:ed|ing)|treated (?:me|us) differently because)\b/i,
  },
  {
    policyClass: 'accessibility',
    rule: 'accessibility_accommodation',
    pattern:
      /\b(ada|wheelchair|accessib\w+|service animal|emotional support animal|reasonable accommodation|disabilit\w+)\b/i,
  },
  {
    policyClass: 'safety',
    rule: 'safety_incident',
    pattern:
      /\b(assault\w*|shooting|gun|weapon|stabb\w+|break[- ]?in|broke into|burglar\w*|robber\w*|attack\w*|carbon monoxide|fire hazard|gas leak|unsafe)\b/i,
  },
  {
    policyClass: 'legal_threat',
    rule: 'legal_threat_language',
    pattern:
      /\b(lawyer|attorney|sue|suing|lawsuit|legal action|small claims|court|code enforcement|housing authority|health department|attorney general)\b/i,
  },
  {
    policyClass: 'privacy',
    rule: 'personal_data_exposure',
    pattern:
      /\b(unit\s*#?\s*\d{1,5}|apartment\s*#?\s*\d{1,5}|apt\.?\s*#?\s*\d{1,5}|\d{3}[-.\s]\d{3}[-.\s]\d{4}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/i,
  },
  {
    policyClass: 'habitability',
    rule: 'habitability_condition',
    pattern:
      /\b(mold|asbestos|no (?:heat|hot water|water|electricity)|sewage|flood\w*|infest\w+|roach\w*|bed ?bugs?|rats?|mice|uninhabitable|condemned)\b/i,
  },
  {
    policyClass: 'employee_accusation',
    rule: 'named_employee_accusation',
    pattern:
      /\b(manager|leasing agent|maintenance (?:man|guy|tech|worker)|staff member|employee)\b[^.!?]{0,80}\b(rude|lied|lying|stole|stealing|harass\w+|threat\w+|drunk|incompetent|racist|yelled|screamed)\b/i,
  },
  {
    policyClass: 'compensation_liability',
    rule: 'compensation_demand',
    pattern:
      /\b(refund|reimburse\w*|compensat\w+|pay (?:me|us) back|owe (?:me|us)|damages|withheld? (?:my|our) deposit|stole (?:my|our) deposit)\b/i,
  },
]

/**
 * Phrases the response generator must never produce. Used as a deterministic
 * output check on generated responses.
 */
const PROHIBITED_RESPONSE_PATTERNS: Array<{ rule: string; pattern: RegExp }> = [
  { rule: 'unsupported_promise', pattern: /\b(we (?:will|'ll) (?:refund|reimburse|compensate|waive)|full refund|money back)\b/i },
  { rule: 'resident_disclosure', pattern: /\b(your (?:lease|account|balance|unit \d+|payment history)|our records show)\b/i },
  { rule: 'identity_inference', pattern: /\b(we know who you are|we have identified you|according to (?:your|our) file)\b/i },
  { rule: 'legal_admission', pattern: /\b(we (?:admit|acknowledge) (?:fault|liability)|it (?:was|is) our fault legally)\b/i },
]

const POLICY_CLASS_SEVERITY_ORDER: PolicyClass[] = [
  'standard',
  'privacy',
  'compensation_liability',
  'employee_accusation',
  'accessibility',
  'habitability',
  'legal_threat',
  'safety',
  'discrimination',
  'fair_housing',
]

function mostSevere(classes: PolicyClass[]): PolicyClass {
  let best: PolicyClass = 'standard'
  for (const cls of classes) {
    if (POLICY_CLASS_SEVERITY_ORDER.indexOf(cls) > POLICY_CLASS_SEVERITY_ORDER.indexOf(best)) {
      best = cls
    }
  }
  return best
}

/**
 * Evaluate deterministic policy rules for a review, optionally merging a
 * model-proposed policy class (which can only escalate, never downgrade).
 */
export function evaluateReviewPolicy(input: {
  reviewText: string
  modelPolicyClass?: PolicyClass | null
  modelConfidence?: number | null
  riskClass?: RiskClass | null
}): PolicyEvaluation {
  const text = input.reviewText || ''
  const flags: PolicyFlag[] = []

  for (const rule of PATTERN_RULES) {
    const match = text.match(rule.pattern)
    if (match) {
      flags.push({
        policyClass: rule.policyClass,
        rule: rule.rule,
        matchedText: match[0].slice(0, 120),
      })
    }
  }

  const candidateClasses: PolicyClass[] = flags.map((flag) => flag.policyClass)
  if (input.modelPolicyClass && input.modelPolicyClass !== 'standard') {
    candidateClasses.push(input.modelPolicyClass)
  }

  const policyClass = mostSevere(candidateClasses)
  const lowModelConfidence =
    typeof input.modelConfidence === 'number' && input.modelConfidence < 0.6

  const reasons: string[] = flags.map(
    (flag) => `Deterministic rule '${flag.rule}' matched (${flag.policyClass}).`
  )
  if (input.modelPolicyClass && input.modelPolicyClass !== 'standard') {
    reasons.push(`Model classified review as '${input.modelPolicyClass}'.`)
  }
  if (lowModelConfidence) {
    reasons.push('Model confidence below 0.6; manual review required.')
  }
  if (input.riskClass === 'legal_regulatory') {
    reasons.push('Risk class legal_regulatory requires manager review.')
  }

  const requiresHumanReview =
    SENSITIVE_POLICY_CLASSES.has(policyClass) ||
    lowModelConfidence ||
    input.riskClass === 'legal_regulatory'

  return {
    policyVersion: POLICY_ENGINE_VERSION,
    policyClass,
    flags,
    requiresHumanReview,
    autoActionEligible: !requiresHumanReview,
    reasons: reasons.length > 0 ? reasons : ['No policy rules matched; standard handling.'],
  }
}

export type ResponsePolicyCheck = {
  passed: boolean
  violations: Array<{ rule: string; matchedText: string }>
}

/** Deterministic output gate for generated response text. */
export function checkResponseText(responseText: string): ResponsePolicyCheck {
  const violations: Array<{ rule: string; matchedText: string }> = []
  for (const { rule, pattern } of PROHIBITED_RESPONSE_PATTERNS) {
    const match = (responseText || '').match(pattern)
    if (match) {
      violations.push({ rule, matchedText: match[0].slice(0, 120) })
    }
  }
  return { passed: violations.length === 0, violations }
}
