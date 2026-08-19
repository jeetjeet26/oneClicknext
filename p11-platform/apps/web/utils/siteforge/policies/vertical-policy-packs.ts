import { z } from 'zod'
import { guidedEvidenceEntrySchema } from '@/utils/siteforge/guided/contracts'
import type {
  ComposedVerticalManifest,
  VerticalEvidenceKind,
  VerticalPolicyCode,
} from '@/utils/siteforge/verticals/contracts'

export const verticalClaimSchema = z
  .object({
    id: z.string().trim().min(1).max(240),
    text: z.string().trim().min(1).max(10_000),
    evidenceIds: z.array(z.string().trim().min(1).max(240)).max(100),
    sourceUrl: z.string().url().nullable(),
    sourceRecordId: z.string().trim().min(1).max(240).nullable(),
    asOf: z.string().datetime().nullable(),
    owner: z.string().trim().min(1).max(240).nullable(),
    confidence: z.number().min(0).max(1),
    expiresAt: z.string().datetime().nullable(),
    approved: z.boolean(),
    inferredByAi: z.boolean(),
  })
  .strict()

export type VerticalClaim = z.infer<typeof verticalClaimSchema>
type GuidedEvidenceEntry = z.infer<typeof guidedEvidenceEntrySchema>

export type VerticalPolicyDefinition = {
  code: VerticalPolicyCode
  version: 1
  requiredEvidenceKinds: readonly VerticalEvidenceKind[]
  requiresApprovedPropertyPolicy: boolean
  nonWaivable: boolean
  aiMode: 'format_only' | 'source_bound' | 'never_infer'
  omissionMode: 'omit_unsourced_facts' | 'block_publication'
  requiredDisclosures: readonly string[]
  prohibitedClaimPatterns: readonly RegExp[]
  manualChecks: readonly string[]
}

function policy(
  code: VerticalPolicyCode,
  value: Omit<
    VerticalPolicyDefinition,
    'code' | 'version' | 'omissionMode' | 'requiredDisclosures'
  > &
    Partial<
      Pick<VerticalPolicyDefinition, 'omissionMode' | 'requiredDisclosures'>
    >
): VerticalPolicyDefinition {
  return {
    code,
    version: 1,
    omissionMode: 'block_publication',
    requiredDisclosures: [],
    ...value,
  }
}

const accessibilityChecks = [
  'Keyboard-only navigation',
  'Screen-reader landmark and control review',
  '200% and 400% zoom review',
  'Visible focus and reduced-motion review',
] as const

export const SITEFORGE_VERTICAL_POLICIES = Object.freeze({
  fair_housing: policy('fair_housing', {
    requiredEvidenceKinds: [],
    requiresApprovedPropertyPolicy: false,
    nonWaivable: true,
    aiMode: 'never_infer',
    prohibitedClaimPatterns: [
      /ideal for (?:families|singles|young professionals)/i,
      /safe(?:st)? neighborhood/i,
      /exclusive community/i,
      /no children/i,
    ],
    manualChecks: ['Fair Housing language and imagery review'],
  }),
  affordable_eligibility_waitlist: policy('affordable_eligibility_waitlist', {
    requiredEvidenceKinds: ['eligibility'],
    requiresApprovedPropertyPolicy: true,
    nonWaivable: true,
    aiMode: 'never_infer',
    prohibitedClaimPatterns: [/guaranteed eligib/i, /automatically qualif/i],
    manualChecks: ['Eligibility, income-limit, and waitlist source review'],
  }),
  hopa_55_plus: policy('hopa_55_plus', {
    requiredEvidenceKinds: ['eligibility'],
    requiresApprovedPropertyPolicy: true,
    nonWaivable: true,
    aiMode: 'never_infer',
    prohibitedClaimPatterns: [/\b55\+\b/i, /active adult/i, /age restricted/i],
    manualChecks: ['Approved HOPA/age-qualification review'],
  }),
  care_licensing_services: policy('care_licensing_services', {
    requiredEvidenceKinds: ['licensing', 'services'],
    requiresApprovedPropertyPolicy: true,
    nonWaivable: true,
    aiMode: 'never_infer',
    prohibitedClaimPatterns: [/licensed (?:care|nursing)/i, /clinical outcome/i],
    manualChecks: ['License, service, and jurisdiction review'],
  }),
  health_data_minimization: policy('health_data_minimization', {
    requiredEvidenceKinds: [],
    requiresApprovedPropertyPolicy: false,
    nonWaivable: true,
    aiMode: 'never_infer',
    prohibitedClaimPatterns: [/diagnos/i, /medicat/i, /medical suitability/i],
    manualChecks: ['Confirm public forms collect no health information'],
  }),
  pricing_availability: policy('pricing_availability', {
    requiredEvidenceKinds: ['pricing', 'availability'],
    requiresApprovedPropertyPolicy: false,
    nonWaivable: true,
    aiMode: 'source_bound',
    omissionMode: 'omit_unsourced_facts',
    requiredDisclosures: [
      'Display an as-of date for published pricing and availability.',
      'Keep approved pricing and availability published until the operator replaces it; never substitute estimates.',
    ],
    prohibitedClaimPatterns: [/guaranteed price/i, /always available/i],
    manualChecks: ['Pricing, fees, availability, and as-of label review'],
  }),
  renderings_construction: policy('renderings_construction', {
    requiredEvidenceKinds: ['construction_status'],
    requiresApprovedPropertyPolicy: true,
    nonWaivable: true,
    aiMode: 'never_infer',
    omissionMode: 'omit_unsourced_facts',
    requiredDisclosures: [
      'Identify renderings as artist representations.',
      'Qualify construction and completion timing as source-dated and subject to change.',
    ],
    prohibitedClaimPatterns: [/move-in ready/i, /completion guaranteed/i],
    manualChecks: ['Rendering disclosure and construction-date review'],
  }),
  financing_brokerage: policy('financing_brokerage', {
    requiredEvidenceKinds: [],
    requiresApprovedPropertyPolicy: true,
    nonWaivable: true,
    aiMode: 'never_infer',
    requiredDisclosures: [
      'Present brokerage and financing disclosures approved for the applicable jurisdiction.',
    ],
    prohibitedClaimPatterns: [/guaranteed financing/i, /investment return/i],
    manualChecks: ['Brokerage, financing, and jurisdiction disclosure review'],
  }),
  commercial_specifications: policy('commercial_specifications', {
    requiredEvidenceKinds: ['commercial_specifications'],
    requiresApprovedPropertyPolicy: false,
    nonWaivable: true,
    aiMode: 'source_bound',
    prohibitedClaimPatterns: [/lab ready/i, /unlimited power/i],
    manualChecks: ['Suite/building specifications and source-date review'],
  }),
  investor_claims: policy('investor_claims', {
    requiredEvidenceKinds: [],
    requiresApprovedPropertyPolicy: true,
    nonWaivable: true,
    aiMode: 'never_infer',
    prohibitedClaimPatterns: [/guaranteed return/i, /risk[- ]free/i, /cap rate/i],
    manualChecks: ['Investor and performance claim legal review'],
  }),
  brand_licensing: policy('brand_licensing', {
    requiredEvidenceKinds: ['brand_license'],
    requiresApprovedPropertyPolicy: true,
    nonWaivable: true,
    aiMode: 'never_infer',
    prohibitedClaimPatterns: [/officially (?:branded|endorsed)/i],
    manualChecks: ['Brand license, marks, and usage approval review'],
  }),
  privacy_consent: policy('privacy_consent', {
    requiredEvidenceKinds: [],
    requiresApprovedPropertyPolicy: false,
    nonWaivable: true,
    aiMode: 'format_only',
    prohibitedClaimPatterns: [/we never collect data/i, /complete anonymity/i],
    manualChecks: ['Consent copy, destinations, retention, and privacy links'],
  }),
  wcag_2_2_aa: policy('wcag_2_2_aa', {
    requiredEvidenceKinds: [],
    requiresApprovedPropertyPolicy: false,
    nonWaivable: true,
    aiMode: 'format_only',
    prohibitedClaimPatterns: [/fully accessible/i, /100% wcag/i],
    manualChecks: accessibilityChecks,
  }),
  equal_housing_opportunity: policy('equal_housing_opportunity', {
    requiredEvidenceKinds: [],
    requiresApprovedPropertyPolicy: false,
    nonWaivable: true,
    aiMode: 'format_only',
    prohibitedClaimPatterns: [],
    manualChecks: ['Equal Housing Opportunity mark and disclosure review'],
  }),
} satisfies Record<VerticalPolicyCode, VerticalPolicyDefinition>)

export type VerticalPolicyIssue = {
  code:
    | 'missing_policy_version'
    | 'missing_evidence'
    | 'stale_evidence'
    | 'unsourced_claim'
    | 'prohibited_claim'
    | 'ai_inference_prohibited'
  policyCode: VerticalPolicyCode
  severity: 'blocker' | 'warning'
  message: string
  evidenceIds: string[]
  nonWaivable: boolean
}

function policyEvidence(
  entries: readonly GuidedEvidenceEntry[],
  code: VerticalPolicyCode
): GuidedEvidenceEntry[] {
  return entries.filter(entry => {
    if (entry.sourceType !== 'approved_policy') return false
    if (entry.sourceId === code) return true
    const content =
      entry.content && typeof entry.content === 'object'
        ? (entry.content as Record<string, unknown>)
        : null
    return content?.policyCode === code || content?.policy_key === code
  })
}

export function evaluateVerticalPolicies(input: {
  manifest: ComposedVerticalManifest
  evidence: readonly GuidedEvidenceEntry[]
  claims?: readonly VerticalClaim[]
  now?: Date
}): { ready: boolean; issues: VerticalPolicyIssue[]; manualChecks: string[] } {
  const now = input.now || new Date()
  const evidenceById = new Map(input.evidence.map(entry => [entry.id, entry]))
  const issues: VerticalPolicyIssue[] = []
  const manualChecks = new Set<string>()

  for (const policyCode of input.manifest.policyCodes) {
    const definition = SITEFORGE_VERTICAL_POLICIES[policyCode]
    definition.manualChecks.forEach(check => manualChecks.add(check))
    const approvedPolicies = policyEvidence(input.evidence, policyCode)
    if (definition.requiresApprovedPropertyPolicy && !approvedPolicies.length) {
      issues.push({
        code: 'missing_policy_version',
        policyCode,
        severity: 'blocker',
        message: `${policyCode} requires an approved property policy version.`,
        evidenceIds: [],
        nonWaivable: definition.nonWaivable,
      })
    }
    for (const evidenceKind of definition.requiredEvidenceKinds) {
      const matching = input.evidence.filter(entry => entry.kind === evidenceKind)
      if (!matching.length) {
        issues.push({
          code: 'missing_evidence',
          policyCode,
          severity: 'blocker',
          message: `${policyCode} requires approved ${evidenceKind} evidence.`,
          evidenceIds: [],
          nonWaivable: definition.nonWaivable,
        })
      }
      const keepsPublishedInventory =
        evidenceKind === 'pricing' || evidenceKind === 'availability'
      const stale = keepsPublishedInventory
        ? []
        : matching.filter(
            entry => entry.freshUntil && new Date(entry.freshUntil) <= now
          )
      if (stale.length) {
        issues.push({
          code: 'stale_evidence',
          policyCode,
          severity: 'blocker',
          message: `${policyCode} has expired ${evidenceKind} evidence.`,
          evidenceIds: stale.map(entry => entry.id),
          nonWaivable: definition.nonWaivable,
        })
      }
    }

    for (const claim of input.claims || []) {
      const matchingEvidence = claim.evidenceIds
        .map(id => evidenceById.get(id))
        .filter((entry): entry is GuidedEvidenceEntry => Boolean(entry))
      const expired =
        Boolean(claim.expiresAt) && new Date(claim.expiresAt!) <= now
      if (!matchingEvidence.length || expired || !claim.approved) {
        issues.push({
          code: 'unsourced_claim',
          policyCode,
          severity: 'blocker',
          message: `Material claim ${claim.id} is unapproved, expired, or unsourced.`,
          evidenceIds: matchingEvidence.map(entry => entry.id),
          nonWaivable: definition.nonWaivable,
        })
      }
      if (
        definition.prohibitedClaimPatterns.some(pattern =>
          pattern.test(claim.text)
        )
      ) {
        issues.push({
          code: 'prohibited_claim',
          policyCode,
          severity: 'blocker',
          message: `Claim ${claim.id} conflicts with ${policyCode}.`,
          evidenceIds: claim.evidenceIds,
          nonWaivable: definition.nonWaivable,
        })
      }
      if (claim.inferredByAi && definition.aiMode === 'never_infer') {
        issues.push({
          code: 'ai_inference_prohibited',
          policyCode,
          severity: 'blocker',
          message: `AI may not infer claim ${claim.id} under ${policyCode}.`,
          evidenceIds: claim.evidenceIds,
          nonWaivable: definition.nonWaivable,
        })
      }
    }
  }

  return {
    ready: !issues.some(issue => issue.severity === 'blocker'),
    issues,
    manualChecks: [...manualChecks],
  }
}
