import { describe, expect, it } from 'vitest'
import {
  normalizeLegacyBlockContent,
  siteForgeBlockContentSchemas,
  strictGeneratedPageSchema,
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

  it('accepts maps backed by either a sourced address or coordinate pair', () => {
    expect(
      siteForgeBlockContentSchemas['acf/map'].parse({
        address: '120 Juniper Street, Portland, OR 97205',
        zoom_level: 15,
        show_directions: true,
      })
    ).toEqual(
      expect.objectContaining({
        address: '120 Juniper Street, Portland, OR 97205',
      })
    )
    expect(() =>
      siteForgeBlockContentSchemas['acf/map'].parse({
        latitude: 45.5231,
        longitude: -122.6765,
        zoom_level: 15,
        show_directions: true,
      })
    ).not.toThrow()
  })

  it('rejects maps without sourced location data or with partial coordinates', () => {
    expect(() =>
      siteForgeBlockContentSchemas['acf/map'].parse({
        zoom_level: 15,
        show_directions: true,
      })
    ).toThrow('Map requires a sourced address or coordinate pair')
    expect(() =>
      siteForgeBlockContentSchemas['acf/map'].parse({
        latitude: 45.5231,
        zoom_level: 15,
        show_directions: true,
      })
    ).toThrow('Map coordinates require both latitude and longitude')
  })

  it('fails readiness for form providers unsupported by the artifact', () => {
    expect(() =>
      siteForgeBlockContentSchemas['acf/form'].parse({
        heading: 'Contact us',
        form_type: 'contact',
        provider: 'csv_export',
        consent_text: 'I consent to be contacted.',
      })
    ).toThrow()
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
            source: 'manual',
            source_identity: 'approved-import:aspen',
            effective_at: '2026-07-31T11:00:00.000Z',
            expires_at: '2026-08-01T11:00:00.000Z',
            source_updated_at: '2026-07-31T10:00:00.000Z',
          },
        ],
        inventory_snapshot: {
          captured_at: '2026-07-31T12:00:00.000Z',
          content_hash: 'a'.repeat(64),
          max_age_hours: 168,
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

  it('accepts every canonical vertical schema.org type in page SEO', () => {
    const seo = {
      title: 'Verified single-family homes',
      description:
        'Explore verified single-family homes with floor plans, availability, and neighborhood details for every prospective buyer.',
      canonicalPath: '/homes',
      noIndex: false,
      structuredData: [
        'WebPage',
        'Residence',
        'SingleFamilyResidence',
        'Organization',
        { '@context': 'https://schema.org', '@type': 'BreadcrumbList' },
      ],
    }
    expect(() =>
      strictGeneratedPageSchema.shape.seo.parse(seo)
    ).not.toThrow()
  })
})
