import { describe, expect, it } from 'vitest'
import {
  normalizeLegacyBlockContent,
  siteForgeBlockContentSchemas,
  strictSiteForgePageSectionSchema,
} from './block-schemas'

const image = {
  assetId: '11111111-1111-4111-8111-111111111111',
  url: 'https://cdn.example.com/hero.jpg',
  alt: 'Courtyard seating beside the pool',
  width: 1_920,
  height: 1_080,
  contentHash: 'a'.repeat(64),
}

describe('SiteForge exact block schemas', () => {
  it('accepts the exact Hero Image Slider contract', () => {
    expect(
      strictSiteForgePageSectionSchema.parse({
        id: 'home-hero',
        type: 'hero',
        acfBlock: 'acf/top-slides',
        order: 0,
        reasoning: 'Establish the verified property promise.',
        evidenceIds: ['brand-1'],
        content: {
          slides: [
            {
              image,
              headline: 'Life, thoughtfully connected',
              cta_text: 'Schedule a tour',
              cta_link: '/contact',
            },
          ],
          autoplay: true,
          overlay_style: 'gradient',
        },
      })
    ).toEqual(
      expect.objectContaining({
        acfBlock: 'acf/top-slides',
      })
    )
  })

  it('rejects generic content that does not match the selected ACF block', () => {
    expect(() =>
      strictSiteForgePageSectionSchema.parse({
        id: 'home-hero',
        type: 'hero',
        acfBlock: 'acf/top-slides',
        order: 0,
        reasoning: 'Generic output must fail.',
        content: {
          headline: 'This omits the required slides collection',
          content: 'Generic body copy',
        },
      })
    ).toThrow()
  })

  it('rejects executable HTML at the generation boundary', () => {
    expect(() =>
      siteForgeBlockContentSchemas['acf/html-section'].parse({
        html_content: '<script>alert("unsafe")</script>',
      })
    ).toThrow('Executable and embedded HTML is not allowed')
  })

  it('accepts immutable floor-plan inventory metadata and rows', () => {
    expect(
      siteForgeBlockContentSchemas['acf/plans-availability'].parse({
        data_source: 'siteforge',
        floor_plans: [
          {
            id: 'aspen-a1',
            name: 'Aspen',
            bedrooms: 1,
            bathrooms: 1,
            rent_min: 1_895,
            available_count: 2,
            image_url: 'https://cdn.example.com/aspen.png',
            image_alt: 'Aspen one-bedroom floor plan',
          },
        ],
        inventory_snapshot: {
          captured_at: '2026-07-31T12:00:00.000Z',
          content_hash: 'a'.repeat(64),
        },
        display_style: 'cards',
        filter_options: ['bedrooms', 'price', 'availability'],
        show_pricing: true,
        show_availability: true,
        freshness_hours: 168,
      }).floor_plans
    ).toHaveLength(1)
  })

  it('strips known legacy extras before strict revision validation', () => {
    const [page] = normalizeLegacyBlockContent([
      {
        slug: 'neighborhood',
        title: 'Neighborhood',
        purpose: 'Help visitors explore nearby destinations.',
        sections: [
          {
            id: 'neighborhood-poi',
            type: 'poi-map',
            acfBlock: 'acf/poi',
            order: 0,
            reasoning: 'Show nearby categories without unsupported claims.',
            content: {
              headline: 'Connected to What Matters',
              intro_text: 'Explore the neighborhood.',
              categories: ['restaurants', 'shopping'],
              radius_miles: 1,
            },
          },
        ],
      },
    ])

    expect(page.sections[0].content).toEqual({
      intro_text: 'Explore the neighborhood.',
      categories: ['restaurants', 'shopping'],
      radius_miles: 1,
    })
    expect(() => strictSiteForgePageSectionSchema.parse(page.sections[0])).not.toThrow()
  })
})
