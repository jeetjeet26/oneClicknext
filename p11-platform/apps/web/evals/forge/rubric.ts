import type { PremiumCreativeMetricId } from './contracts'

export type PremiumCreativeRubricEntry = {
  metric: PremiumCreativeMetricId
  weight: number
  threshold: number
  intent: string
}

export const PREMIUM_CREATIVE_PASS_THRESHOLD = 0.72

export const PREMIUM_CREATIVE_RUBRIC: readonly PremiumCreativeRubricEntry[] = [
  {
    metric: 'narrative_clarity',
    weight: 0.1,
    threshold: 0.7,
    intent: 'The page advances a legible, property-specific story.',
  },
  {
    metric: 'hierarchy',
    weight: 0.1,
    threshold: 0.7,
    intent: 'Primary, secondary, and supporting moments are unambiguous.',
  },
  {
    metric: 'composition_pacing',
    weight: 0.1,
    threshold: 0.65,
    intent: 'Layout and section rhythm create deliberate contrast.',
  },
  {
    metric: 'image_direction',
    weight: 0.1,
    threshold: 0.65,
    intent: 'Image briefs specify subject, framing, light, and mood.',
  },
  {
    metric: 'brand_distinctiveness',
    weight: 0.1,
    threshold: 0.65,
    intent: 'Copy expresses named brand ideas rather than category filler.',
  },
  {
    metric: 'mobile_quality',
    weight: 0.1,
    threshold: 0.75,
    intent: 'Every section has an intentional small-screen treatment.',
  },
  {
    metric: 'inventory_usability',
    weight: 0.1,
    threshold: 0.75,
    intent: 'Inventory is filterable, current, legible, and actionable.',
  },
  {
    metric: 'signature_experience',
    weight: 0.1,
    threshold: 0.65,
    intent: 'The experience contains a memorable, branded interaction.',
  },
  {
    metric: 'generic_language_rate',
    weight: 0.1,
    threshold: 0.75,
    intent: 'Generic real-estate language remains rare.',
  },
  {
    metric: 'repeated_copy_similarity',
    weight: 0.1,
    threshold: 0.75,
    intent: 'Sections do not recycle materially similar copy.',
  },
] as const
