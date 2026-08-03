import { describe, expect, it } from 'vitest'
import type { BrandContext } from '@/utils/siteforge/agents/brand-agent'
import {
  hashBrandForgeContract,
  normalizeBrandForgeContract,
} from '@/utils/brandforge/normalize'
import { buildSiteForgePlan } from './builder'

const brandContext: BrandContext = {
  source: 'brandforge',
  confidence: 0.92,
  brandPersonality: {
    primary: 'Composed',
    traits: ['warm', 'editorial'],
    avoid: ['hype'],
  },
  visualIdentity: {
    moodKeywords: ['natural', 'refined'],
    colorMood: 'earthy',
    photoStyle: {
      lighting: 'natural',
      composition: 'editorial',
      subjects: 'architecture and amenities',
      mood: 'calm',
    },
    designStyle: 'Modern editorial',
  },
  targetAudience: {
    demographics: 'Untrusted demographic prose that must not become targeting copy',
    psychographics: 'Untrusted psychographic prose',
    priorities: ['clear floor-plan information', 'tour scheduling'],
    painPoints: [],
  },
  positioning: {
    category: 'Multifamily',
    differentiators: ['Rooftop lounge', 'Transit access'],
    competitiveAdvantage: 'Well-connected homes with thoughtful shared spaces',
    messagingPillars: ['Connection', 'Comfort'],
  },
  contentStrategy: {
    voiceTone: 'Warm and direct',
    vocabularyUse: ['considered'],
    vocabularyAvoid: ['exclusive'],
    headlineStyle: 'Short',
    storytellingFocus: 'Daily life',
  },
  designPrinciples: ['Clarity'],
}
const brandContract = normalizeBrandForgeContract({
  identity: { name: 'Aurora Denver' },
}, { origin: 'generated', approvalStatus: 'approved' })

describe('buildSiteForgePlan', () => {
  it('builds a validated, deterministic multifamily plan', () => {
    const plan = buildSiteForgePlan({
      propertyId: '11111111-1111-4111-8111-111111111111',
      propertyName: 'Aurora Denver',
      brandContext,
      brandAssetId: '22222222-2222-4222-8222-222222222222',
      brandContract,
      brandContractHash: hashBrandForgeContract(brandContract),
      onboardingSnapshot: {
        id: '33333333-3333-4333-8333-333333333333',
        contentHash: 'a'.repeat(64),
        enabledCapabilities: ['tours', 'analytics'],
        sourceReferences: [],
      },
      preferences: {
        style: 'luxury',
        emphasis: 'location',
        ctaPriority: 'tours',
      },
      operatorDirection: 'Give the neighborhood story more visual weight.',
      capturedAt: '2026-07-30T17:00:00.000Z',
    })

    expect(plan.pages.map((page) => page.slug)).toEqual([
      'home',
      'floor-plans',
      'amenities',
      'neighborhood',
      'contact',
    ])
    expect(plan.conversionStrategy.primaryAction).toBe('tours')
    expect(plan.brandDirection.mustInclude).toContain(
      'Operator direction: Give the neighborhood story more visual weight.'
    )
    expect(JSON.stringify(plan)).not.toContain('Untrusted demographic prose')
    expect(plan.evidence).toEqual([
      expect.objectContaining({
        sourceType: 'brandforge',
        retrievalStatus: 'available',
      }),
    ])
  })
})
