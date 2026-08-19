export const PREMIUM_CREATIVE_EVALUATOR_VERSION =
  'siteforge-premium-creative-v1'
export const PREMIUM_CREATIVE_RUBRIC_VERSION =
  'siteforge-premium-rubric-v1'

export const premiumCreativeMetricIds = [
  'narrative_clarity',
  'hierarchy',
  'composition_pacing',
  'image_direction',
  'brand_distinctiveness',
  'mobile_quality',
  'inventory_usability',
  'signature_experience',
  'generic_language_rate',
  'repeated_copy_similarity',
] as const

export type PremiumCreativeMetricId =
  (typeof premiumCreativeMetricIds)[number]

export type PremiumCreativeVertical =
  | 'multifamily'
  | 'lease_up'
  | 'for_sale'
  | 'master_planned'
  | 'homebuilder'

export type PremiumCreativeSection = {
  id: string
  kind:
    | 'hero'
    | 'story'
    | 'amenities'
    | 'inventory'
    | 'neighborhood'
    | 'signature'
    | 'cta'
  headline: string
  copy: string
  layout: string
  emphasis: 'primary' | 'secondary' | 'supporting'
  imageDirection?: string
  mobileTreatment?: string
  inventory?: {
    filters: string[]
    showsPricing: boolean
    showsStatus: boolean
    cardCta: string
    mobileColumns: number
  }
  signatureInteraction?: string
}

export type PremiumCreativeCandidate = {
  id: string
  pairId: string
  quality: 'premium' | 'bland'
  vertical: PremiumCreativeVertical
  brandName: string
  brandTerms: string[]
  sections: PremiumCreativeSection[]
}

export type PremiumCreativeFinding = {
  id: string
  code: string
  metric: PremiumCreativeMetricId
  severity: 'blocker' | 'warning'
  score: number
  threshold: number
  message: string
  locations: string[]
  evidence: Record<string, string | number | boolean | string[]>
  source: 'deterministic' | 'multimodal_critic'
}

export type PremiumCreativeMetricScore = {
  metric: PremiumCreativeMetricId
  score: number
  weight: number
  findings: PremiumCreativeFinding[]
}

export type PremiumCreativeEvaluation = {
  schemaVersion: 1
  evaluatorVersion: string
  rubricVersion: string
  model: {
    provider: 'local'
    model: 'deterministic'
    version: string
  }
  candidateId: string
  pairId: string
  vertical: PremiumCreativeVertical
  passed: boolean
  normalizedScore: number
  passThreshold: number
  metrics: PremiumCreativeMetricScore[]
  findings: PremiumCreativeFinding[]
}

export type MultimodalCriticInput = {
  evaluatorVersion: string
  modelVersion: string
  scores: Partial<Record<PremiumCreativeMetricId, number>>
  findings?: Array<
    Omit<PremiumCreativeFinding, 'id' | 'score' | 'source'> & {
      score: number
    }
  >
}

export function normalizeUnitScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000
}

export function normalizeMultimodalCriticInput(
  input: MultimodalCriticInput
): MultimodalCriticInput {
  return {
    ...input,
    scores: Object.fromEntries(
      Object.entries(input.scores).map(([metric, score]) => [
        metric,
        normalizeUnitScore(score),
      ])
    ),
    findings: input.findings?.map((finding, index) => ({
      ...finding,
      id: `${input.evaluatorVersion}:critic:${index}`,
      score: normalizeUnitScore(finding.score),
      source: 'multimodal_critic' as const,
    })),
  }
}
