import { describe, expect, it } from 'vitest'
import type { SiteBlueprint } from '@/types/siteforge'
import { assertInventoryOnlyRevision } from './manual-floor-plan-workflow'

function blueprint(): SiteBlueprint {
  return {
    version: 1,
    updatedAt: '2026-08-17T12:00:00.000Z',
    pages: [
      {
        slug: 'floor-plans',
        title: 'Floor Plans',
        purpose: 'Show inventory',
        sections: [
          {
            id: 'hero',
            type: 'hero',
            acfBlock: 'acf/text-section',
            content: { headline: 'Find your home' },
            reasoning: 'Introduction',
            order: 1,
          },
          {
            id: 'plans',
            type: 'floorplans',
            acfBlock: 'acf/plans-availability',
            content: {
              data_source: 'manual',
              floor_plans: [],
              display_style: 'cards',
              filter_options: ['bedrooms'],
              show_pricing: true,
              show_availability: true,
              freshness_hours: 168,
            },
            reasoning: 'Approved inventory',
            order: 2,
          },
        ],
      },
    ],
  }
}

describe('manual floor-plan workflow', () => {
  it('allows deterministic inventory content replacement', () => {
    const original = blueprint()
    const candidate = structuredClone(original)
    candidate.updatedAt = '2026-08-17T13:00:00.000Z'
    candidate.pages[0].sections[1].content = {
      ...candidate.pages[0].sections[1].content,
      floor_plans: [{ id: 'aspen', name: 'Aspen', bedrooms: 1 }],
    }

    expect(() => assertInventoryOnlyRevision(original, candidate)).not.toThrow()
  })

  it('rejects unrelated copy, layout, or design changes', () => {
    const original = blueprint()
    const candidate = structuredClone(original)
    candidate.pages[0].sections[0].content = { headline: 'Changed by inventory refresh' }

    expect(() => assertInventoryOnlyRevision(original, candidate)).toThrow(
      'attempted to alter unrelated website content'
    )
  })
})
