import { describe, expect, it } from 'vitest'
import type { GeneratedPage } from '@/types/siteforge'
import {
  evaluateSiteForgePremiumCreative,
  extractBrandTerms,
  selectPrimaryNarrativePage,
} from './premium-creative'

function section(
  overrides: Partial<GeneratedPage['sections'][number]> & {
    type: string
    order: number
  }
): GeneratedPage['sections'][number] {
  return {
    acfBlock: 'content_split',
    content: {},
    reasoning: 'test',
    ...overrides,
  } as GeneratedPage['sections'][number]
}

const homePage: GeneratedPage = {
  slug: 'home',
  title: 'Home',
  purpose: 'Convert visitors into tours',
  sections: [
    section({
      id: 'home-hero',
      type: 'hero',
      order: 0,
      content: {
        headline: 'Canyon light, morning quiet',
        subheadline: 'Residences shaped around the arroyo at Sable Ridge.',
        image: 'https://example.com/hero.jpg',
      },
      photoRequirement: {
        direction:
          'Golden-hour view across the arroyo terrace with long shadows and a resident silhouette',
      },
    }),
    section({
      id: 'home-story',
      type: 'story',
      order: 1,
      content: {
        headline: 'Built into the ridge line',
        body: 'Every residence opens to the canyon rather than a corridor.',
      },
    }),
    section({
      id: 'home-amenities',
      type: 'amenities',
      order: 2,
      content: {
        headline: 'The ridge deck',
        body: 'A saltwater pool cantilevered over the arroyo edge.',
      },
    }),
    section({
      id: 'home-floor-plans',
      type: 'floor_plans',
      order: 3,
      content: {
        headline: 'Residences',
        body: 'One to three bedrooms from $2,150 per month, availability updated live.',
        ctaLabel: 'See pricing',
        filters: ['bedrooms', 'price'],
      },
    }),
    section({
      id: 'home-cta',
      type: 'cta_banner',
      order: 4,
      content: {
        headline: 'Walk the ridge',
        ctaLabel: 'Schedule a tour',
      },
    }),
  ],
}

describe('SiteForge premium creative advisory scoring', () => {
  it('selects the home page as the narrative candidate', () => {
    const other: GeneratedPage = { ...homePage, slug: 'amenities' }
    expect(selectPrimaryNarrativePage([other, homePage])?.slug).toBe('home')
    expect(selectPrimaryNarrativePage([other])?.slug).toBe('amenities')
    expect(selectPrimaryNarrativePage([])).toBeNull()
  })

  it('extracts brand terms from a brand context', () => {
    expect(
      extractBrandTerms({
        contentStrategy: { vocabularyUse: ['arroyo', 'ridge'] },
        brandPersonality: { traits: ['grounded'] },
        positioning: { differentiators: ['canyon-edge residences'] },
        visualIdentity: { moodKeywords: ['warm'] },
      })
    ).toEqual(['arroyo', 'ridge', 'grounded', 'canyon-edge residences', 'warm'])
    expect(extractBrandTerms(null)).toEqual([])
  })

  it('produces an advisory evaluation from real generated pages', () => {
    const report = evaluateSiteForgePremiumCreative({
      pages: [homePage],
      brandContext: {
        contentStrategy: { vocabularyUse: ['arroyo', 'ridge'] },
      },
      evaluatedAt: '2026-08-19T18:00:00.000Z',
    })
    expect(report).not.toBeNull()
    expect(report).toMatchObject({
      schemaVersion: 1,
      advisory: true,
      pageSlug: 'home',
      evaluatedAt: '2026-08-19T18:00:00.000Z',
    })
    expect(report!.normalizedScore).toBeGreaterThan(0)
    expect(report!.normalizedScore).toBeLessThanOrEqual(1)
    expect(report!.metrics.length).toBe(10)
  })

  it('classifies inventory sections and detects pricing and status signals', () => {
    const report = evaluateSiteForgePremiumCreative({ pages: [homePage] })
    const inventoryMetric = report!.metrics.find(
      metric => metric.metric === 'inventory_usability'
    )
    // Filters, pricing, status, and card CTA are all present in the fixture.
    expect(inventoryMetric!.score).toBeGreaterThanOrEqual(0.8)
  })

  it('returns null when there is nothing to evaluate', () => {
    expect(evaluateSiteForgePremiumCreative({ pages: [] })).toBeNull()
    expect(
      evaluateSiteForgePremiumCreative({
        pages: [{ ...homePage, sections: [] }],
      })
    ).toBeNull()
  })
})
