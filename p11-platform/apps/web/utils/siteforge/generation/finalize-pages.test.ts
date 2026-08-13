import { describe, expect, it } from 'vitest'
import type { GeneratedPage } from '@/types/siteforge'
import type { PhotoManifest } from '@/utils/siteforge/agents/photo-agent'
import {
  extractSourcedMapLocation,
  finalizeSiteForgePages,
} from './finalize-pages'
import { createSiteForgeLegalConfigFromSnapshot } from '@/utils/siteforge/quality/deterministic-gates'

const approvedLegal = createSiteForgeLegalConfigFromSnapshot({
  legal: {
    id: '11111111-1111-4111-8111-111111111111',
    version: 2,
    status: 'approved',
    approved_at: '2026-07-31T20:00:00.000Z',
    effective_at: '2026-08-01T00:00:00.000Z',
    privacy_policy: { text: 'Approved privacy body, exactly as reviewed.' },
    terms: { text: 'Approved terms body, exactly as reviewed.' },
    accessibility: {
      text: 'Approved accessibility body, exactly as reviewed.',
    },
    fair_housing: {
      text: 'Approved Equal Housing Opportunity statement.',
    },
    pricing_disclaimer: { text: 'Approved pricing disclaimer.' },
    analytics_consent: { text: 'Approved analytics consent.' },
    communications_consent: {
      text: 'Approved communications consent.',
    },
  },
})

describe('finalizeSiteForgePages', () => {
  it('turns generated copy into exact publishable block contracts', () => {
    const pages: GeneratedPage[] = [
      {
        title: 'Schedule a Tour',
        slug: 'schedule-a-tour',
        purpose: 'Help qualified prospects schedule a property tour',
        sections: [
          {
            id: 'hero',
            type: 'hero',
            acfBlock: 'acf/top-slides',
            order: 0,
            reasoning: 'Lead with the community identity',
            content: {
              headline: 'Welcome home',
              description: 'Explore available apartment homes.',
            },
            evidenceIds: ['brand-1'],
          },
          {
            id: 'contact',
            type: 'form',
            acfBlock: 'acf/form',
            order: 1,
            reasoning: 'Provide a direct conversion path',
            content: { heading: 'Schedule a tour' },
          },
        ],
      },
    ]
    const hero = {
      id: 'photo-1',
      assetId: '11111111-1111-4111-8111-111111111111',
      contentHash: 'a'.repeat(64),
      altText: 'Exterior of the apartment community',
      url: 'https://cdn.example.com/hero.jpg',
      type: 'uploaded' as const,
      category: 'hero',
      quality: 9,
      scene: 'Apartment exterior',
    }
    const manifest: PhotoManifest = {
      photos: [hero],
      byCategory: {
        hero: [hero],
        amenities: [],
        lifestyle: [],
        gallery: [],
        logos: [],
      },
      assignments: { hero: hero.id },
      stats: { uploaded: 1, generated: 0, fromBrandForge: 0, total: 1 },
    }

    const finalized = finalizeSiteForgePages(pages, manifest, approvedLegal)

    expect(finalized[0]?.sections[0]?.content).toEqual(
      expect.objectContaining({
        slides: [
          expect.objectContaining({
            image: expect.objectContaining({ assetId: hero.assetId }),
          }),
        ],
      })
    )
    expect(finalized[0]?.sections[1]?.content).toEqual(
      expect.objectContaining({
        provider: 'p11_lumaleasing',
        form_type: 'tour',
        consent_text: expect.stringContaining('agree'),
      })
    )
  })

  it('replaces testimonial copy with approved ReviewFlow records and evidence ids', () => {
    const manifest: PhotoManifest = {
      photos: [],
      byCategory: {
        hero: [],
        amenities: [],
        lifestyle: [],
        gallery: [],
        logos: [],
      },
      assignments: {},
      stats: { uploaded: 0, generated: 0, fromBrandForge: 0, total: 0 },
    }
    const reviewId = '77777777-7777-4777-8777-777777777777'
    const finalized = finalizeSiteForgePages(
      [
        {
          slug: 'home',
          title: 'Home',
          purpose: 'Introduce the property.',
          sections: [
            {
              id: 'resident-stories',
              type: 'testimonials',
              acfBlock: 'acf/testimonials',
              order: 0,
              reasoning: 'Show approved resident feedback.',
              content: {
                heading: 'Invented heading',
                reviews: [
                  {
                    review_text: 'Generated review text must be discarded.',
                  },
                ],
              },
              evidenceIds: ['generated-evidence'],
            },
          ],
        },
      ],
      manifest,
      approvedLegal,
      undefined,
      [],
      {},
      [
        {
          id: reviewId,
          reviewerName: 'Jordan R.',
          reviewText: 'The team made our move straightforward.',
          rating: 5,
          platform: 'google',
          reviewDate: '2026-07-15T12:00:00.000Z',
        },
      ]
    )

    expect(finalized[0].sections[0]).toMatchObject({
      acfBlock: 'acf/testimonials',
      evidenceIds: [reviewId],
      content: {
        source: 'reviewflow',
        reviews: [
          {
            id: reviewId,
            reviewer_name: 'Jordan R.',
            review_text: 'The team made our move straightforward.',
            rating: 5,
          },
        ],
      },
    })
    expect(JSON.stringify(finalized)).not.toContain(
      'Generated review text must be discarded.'
    )
  })

  it('publishes map content only from the pinned property location source', () => {
    const mapLocation = extractSourcedMapLocation({
      property: {
        address: {
          street: '120 Juniper Street',
          city: 'Portland',
          state: 'OR',
          zip: '97205',
        },
        latitude: 45.5231,
        longitude: -122.6765,
      },
    })
    const manifest: PhotoManifest = {
      photos: [],
      byCategory: {
        hero: [],
        amenities: [],
        lifestyle: [],
        gallery: [],
        logos: [],
      },
      assignments: {},
      stats: { uploaded: 0, generated: 0, fromBrandForge: 0, total: 0 },
    }
    const finalized = finalizeSiteForgePages(
      [
        {
          slug: 'neighborhood',
          title: 'Neighborhood',
          purpose: 'Help visitors find the community.',
          sections: [
            {
              id: 'neighborhood-map',
              type: 'map',
              acfBlock: 'acf/map',
              order: 0,
              reasoning: 'Provide sourced location details.',
              content: {
                address: 'AI-generated address must not win',
                zoom_level: 14,
              },
            },
          ],
        },
      ],
      manifest,
      approvedLegal,
      undefined,
      [],
      { mapLocation }
    )

    expect(finalized[0].sections[0].content).toEqual({
      address: '120 Juniper Street, Portland, OR, 97205',
      latitude: 45.5231,
      longitude: -122.6765,
      zoom_level: 14,
      show_directions: true,
    })
  })

  it('fails finalization when the confirmed form provider is unsupported', () => {
    const manifest: PhotoManifest = {
      photos: [],
      byCategory: {
        hero: [],
        amenities: [],
        lifestyle: [],
        gallery: [],
        logos: [],
      },
      assignments: {},
      stats: { uploaded: 0, generated: 0, fromBrandForge: 0, total: 0 },
    }

    expect(() =>
      finalizeSiteForgePages(
        [
          {
            slug: 'contact',
            title: 'Contact',
            purpose: 'Contact the leasing team.',
            sections: [
              {
                id: 'contact-form',
                type: 'form',
                acfBlock: 'acf/form',
                order: 0,
                reasoning: 'Capture a lead.',
                content: { heading: 'Contact us', form_type: 'contact' },
              },
            ],
          },
        ],
        manifest,
        approvedLegal,
        undefined,
        [],
        {
          formProviders: {
            lead: 'csv_export',
            tour: 'unconfigured',
          },
        }
      )
    ).toThrow()
  })

  it('renders the approved inventory snapshot as real floor-plan rows', () => {
    const pages: GeneratedPage[] = [
      {
        title: 'Floor Plans',
        slug: 'floor-plans',
        purpose: 'Show approved apartment inventory.',
        sections: [
          {
            id: 'plans',
            type: 'floorplans',
            acfBlock: 'acf/plans-availability',
            order: 0,
            reasoning: 'Publish approved inventory.',
            content: {
              rent_min: 9_999,
              rent_max: 12_999,
              show_pricing: true,
              show_availability: true,
            },
          },
        ],
      },
    ]
    const manifest: PhotoManifest = {
      photos: [],
      byCategory: {
        hero: [],
        amenities: [],
        lifestyle: [],
        gallery: [],
        logos: [],
      },
      assignments: {},
      stats: { uploaded: 0, generated: 0, fromBrandForge: 0, total: 0 },
    }
    const finalized = finalizeSiteForgePages(
      pages,
      manifest,
      approvedLegal,
      {
        capturedAt: '2026-07-31T12:00:00.000Z',
        contentHash: 'b'.repeat(64),
        rows: [
          {
            id: 'aspen-a1',
            name: 'Aspen',
            bedrooms: 1,
            bathrooms: 1,
            sqftMin: 720,
            rentMin: 1_895,
            availableCount: 2,
            imageUrl: 'https://cdn.example.com/aspen.png',
            imageAlt: 'Aspen one-bedroom floor plan',
            applyUrl: 'https://property.example.com/apply/aspen',
            source: 'manual',
            sourceIdentity: 'approved-import-42',
            effectiveAt: '2026-07-31T11:00:00.000Z',
            expiresAt: '2026-08-01T11:00:00.000Z',
            sourceUpdatedAt: '2026-07-31T10:00:00.000Z',
          },
        ],
      },
      [],
      {
        floorPlanStrategy: {
          display: 'cards',
          showPricing: false,
          showAvailability: true,
          freshnessHours: 24,
        },
      }
    )

    expect(finalized[0]?.sections[0]?.content).toEqual(
      expect.objectContaining({
        floor_plans: [
          expect.objectContaining({
            id: 'aspen-a1',
            name: 'Aspen',
            bedrooms: 1,
            sqft_min: 720,
            rent_min: 1_895,
            available_count: 2,
            source: 'manual',
            source_identity: 'approved-import-42',
            effective_at: '2026-07-31T11:00:00.000Z',
            expires_at: '2026-08-01T11:00:00.000Z',
            source_updated_at: '2026-07-31T10:00:00.000Z',
          }),
        ],
        inventory_snapshot: {
          captured_at: '2026-07-31T12:00:00.000Z',
          content_hash: 'b'.repeat(64),
        },
        show_pricing: false,
        show_availability: true,
        freshness_hours: 24,
      })
    )
    expect(JSON.stringify(finalized)).not.toContain('9999')
    expect(JSON.stringify(finalized)).not.toContain('12999')
  })

  it('builds legal pages only from exact approved policy bodies', () => {
    const manifest: PhotoManifest = {
      photos: [],
      byCategory: {
        hero: [],
        amenities: [],
        lifestyle: [],
        gallery: [],
        logos: [],
      },
      assignments: {},
      stats: { uploaded: 0, generated: 0, fromBrandForge: 0, total: 0 },
    }

    const finalized = finalizeSiteForgePages(
      [
        {
          slug: 'privacy',
          title: 'Generic Privacy',
          purpose: 'Generated placeholder that must be replaced.',
          sections: [],
        },
      ],
      manifest,
      approvedLegal
    )

    expect(finalized.map(page => page.slug)).toEqual([
      'privacy',
      'terms',
      'accessibility',
    ])
    expect(finalized[0].sections[0].content.content).toBe(
      approvedLegal.policyBodies.privacyPolicy
    )
  })

  it('renders approved onboarding points of interest without requiring a map', () => {
    const pages: GeneratedPage[] = [
      {
        title: 'Neighborhood',
        slug: 'neighborhood',
        purpose: 'Show what is nearby.',
        sections: [
          {
            id: 'nearby',
            type: 'poi',
            acfBlock: 'acf/poi',
            order: 0,
            reasoning: 'Publish approved neighborhood facts.',
            content: { body: 'Live near everyday essentials.' },
          },
        ],
      },
    ]
    const manifest: PhotoManifest = {
      photos: [],
      byCategory: {
        hero: [],
        amenities: [],
        lifestyle: [],
        gallery: [],
        logos: [],
      },
      assignments: {},
      stats: { uploaded: 0, generated: 0, fromBrandForge: 0, total: 0 },
    }

    const finalized = finalizeSiteForgePages(pages, manifest, approvedLegal, undefined, [
      {
        name: 'Riverfront Park',
        category: 'parks',
        address: { street: '100 River Road', city: 'Austin' },
        distance_miles: 0.7,
        travel_time_minutes: 4,
        source_url: 'https://example.com/riverfront-park',
      },
    ])

    expect(finalized[0]?.sections[0]?.content).toEqual(
      expect.objectContaining({
        points: [
          expect.objectContaining({
            name: 'Riverfront Park',
            address: '100 River Road, Austin',
            distance_miles: 0.7,
          }),
        ],
      })
    )
  })
})
