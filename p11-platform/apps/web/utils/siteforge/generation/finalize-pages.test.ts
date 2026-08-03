import { describe, expect, it } from 'vitest'
import type { GeneratedPage } from '@/types/siteforge'
import type { PhotoManifest } from '@/utils/siteforge/agents/photo-agent'
import { finalizeSiteForgePages } from './finalize-pages'

describe('finalizeSiteForgePages', () => {
  it('turns generated copy into exact publishable block contracts', () => {
    const pages: GeneratedPage[] = [
      {
        title: 'Home',
        slug: 'home',
        purpose: 'Convert qualified prospects',
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
            content: { heading: 'Schedule a tour', form_type: 'tour' },
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

    const finalized = finalizeSiteForgePages(pages, manifest)

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
        consent_text: expect.stringContaining('agree'),
      })
    )
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
            content: {},
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
    const finalized = finalizeSiteForgePages(pages, manifest, {
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
        },
      ],
    })

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
          }),
        ],
        inventory_snapshot: {
          captured_at: '2026-07-31T12:00:00.000Z',
          content_hash: 'b'.repeat(64),
        },
      })
    )
  })
})
