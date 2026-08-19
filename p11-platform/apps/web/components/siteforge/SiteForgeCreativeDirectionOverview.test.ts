import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { guidedCreativeDirectionOverviewSchema } from '@/utils/siteforge/guided/contracts'
import { SiteForgeCreativeDirectionOverview } from './SiteForgeCreativeDirectionOverview'

function candidate(id: string, ordinal: number, name: string) {
  return {
    id,
    ordinal,
    name,
    contentHash: String(ordinal).repeat(64),
    previewManifest: {
      paletteSwatches: ['#112233', '#445566', '#778899', '#FFFFFF', '#111111'],
      heroMode: 'editorial-split',
      layoutMode: 'offset-grid',
      typographyPairing: 'Fraunces / Inter',
    },
    direction: {
      rationale: `${name} balances brand warmth with conversion clarity.`,
      typography: {
        headingFamily: 'Fraunces',
        bodyFamily: 'Inter',
        scale: 'Large editorial',
        weightStrategy: 'Regular headings and medium body emphasis',
      },
      palette: {
        primary: '#112233',
        secondary: '#445566',
        accent: '#778899',
        background: '#FFFFFF',
        text: '#111111',
      },
      hero: {
        composition: 'Editorial split',
        headlineStyle: 'Short and confident',
        mediaTreatment: 'Warm natural photography',
      },
      layout: {
        system: 'Offset grid',
        density: 'Airy',
        sectionRhythm: 'Measured narrative chapters',
      },
      imagery: {
        style: 'Natural architectural editorial',
        subjects: ['Amenities', 'Residences'],
        treatment: 'Warm crops with minimal overlays',
      },
      cta: {
        label: 'Schedule a tour',
        placement: 'Hero and closing section',
        style: 'High-contrast filled action',
      },
      voice: {
        traits: ['Warm', 'Clear'],
        do: ['Use verified details'],
        dont: ['Invent claims'],
      },
      tradeoffs: ['Benefits from strong property photography'],
      provenance: {
        generator: 'siteforge-deterministic-directions-v1' as const,
        briefVersionId: '11111111-1111-4111-8111-111111111111',
        briefContentHash: 'a'.repeat(64),
        onboardingSnapshotId: '22222222-2222-4222-8222-222222222222',
        onboardingSnapshotHash: 'b'.repeat(64),
        brandAssetId: '33333333-3333-4333-8333-333333333333',
        brandContractHash: 'c'.repeat(64),
      },
    },
  }
}

describe('SiteForgeCreativeDirectionOverview', () => {
  it('renders the complete brand board, editor, and selectable alternatives', () => {
    const overview = guidedCreativeDirectionOverviewSchema.parse({
      directionSetId: 'set-1',
      directionSetContentHash: 'd'.repeat(64),
      selected: candidate('direction-1', 1, 'Editorial Confidence'),
      alternatives: [candidate('direction-2', 2, 'Conversion Clarity')],
      recommendationReason: 'Best fit for the approved brand and tour goal.',
      brandPresentation: {
        name: 'The Aurora',
        logo: {
          url: 'https://cdn.example.com/aurora-logo.svg',
          alt: 'The Aurora',
          role: 'primary',
        },
        palette: [
          {
            role: 'primary',
            name: 'Midnight',
            hex: '#112233',
            usage: 'Primary brand field',
          },
          {
            role: 'secondary',
            name: 'Gold',
            hex: '#C9A962',
            usage: 'Brand highlights',
          },
          {
            role: 'surface',
            name: 'Ivory',
            hex: '#FFF1E8',
            usage: 'Warm surfaces',
          },
        ],
        usageGuidelines: 'Use gold sparingly against midnight and ivory.',
      },
    })
    const markup = renderToStaticMarkup(
      createElement(SiteForgeCreativeDirectionOverview, {
        overview,
        busy: false,
        onEdit: vi.fn(),
        onSelectAlternative: vi.fn(),
      }),
    )

    expect(markup).toContain('Approved brand')
    expect(markup).toContain('Full approved palette')
    expect(markup).toContain('aurora-logo.svg')
    expect(markup).toContain('Proposed website color roles')
    expect(markup).toContain('Fraunces')
    expect(markup).toContain('Hero and layout')
    expect(markup).toContain('Photography')
    expect(markup).toContain('Voice')
    expect(markup).toContain('Schedule a tour')
    expect(markup).toContain('Why this direction')
    expect(markup).toContain('Creative direction edit')
    expect(markup).toContain('Use this direction')
  })
})
