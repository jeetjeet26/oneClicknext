import { describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/siteforge/imagen-client', () => ({
  isImagenAvailable: () => false,
  generateAndUploadImage: vi.fn(),
  buildLifestylePhotoPrompt: vi.fn(),
}))
import {
  applyApprovedCreativeDirectionToDesignSystem,
  type DesignSystem,
} from '@/utils/siteforge/agents/design-agent'
import { buildApprovedContentGuidance } from '@/utils/siteforge/agents/content-agent'
import {
  applyApprovedDirectionToPhotoStrategy,
  type PhotoStrategy,
} from '@/utils/siteforge/agents/photo-agent'
import type { SiteForgeBrief } from '@/utils/siteforge/briefs/contracts'
import type { SiteForgePlan } from '@/utils/siteforge/contracts'
import { generateDeterministicCreativeDirections } from '@/utils/siteforge/directions/generator'
import {
  assertRegisteredSiteForgeArchitecture,
  composeApprovedSiteForgeArchitecture,
  type SiteForgeCreativeExecutionContext,
} from './creative-execution'

const brief: SiteForgeBrief = {
  title: 'Aurora website',
  summary: 'Make the verified property story clear and useful.',
  objectives: [
    {
      statement: 'Increase qualified tour requests',
      priority: 'primary',
      successSignal: 'More completed tour forms',
    },
  ],
  audiences: [
    {
      segment: 'Prospective residents',
      needs: ['Clear availability', 'A credible sense of place'],
      objections: ['Unclear pricing'],
    },
  ],
  conversion: {
    primaryAction: 'Schedule a tour',
    secondaryActions: ['View floor plans'],
    funnelNotes: 'Show proof before asking for contact details.',
  },
  scope: {
    includedPages: ['Home'],
    excludedItems: [],
  },
  stakeholders: [],
  approvers: [],
  launchTarget: {
    targetDate: null,
    timezone: 'America/Denver',
    flexibility: 'flexible',
  },
  legalConstraints: [],
  integrationConstraints: [],
  references: [],
  kpis: [
    {
      name: 'Tour conversion',
      target: 'Improve from baseline',
      measurement: 'Completed tour forms',
    },
  ],
}

const sources = {
  briefVersionId: '11111111-1111-4111-8111-111111111111',
  briefContentHash: 'a'.repeat(64),
  onboardingSnapshotId: '22222222-2222-4222-8222-222222222222',
  onboardingSnapshotHash: 'b'.repeat(64),
  brandAssetId: '33333333-3333-4333-8333-333333333333',
  brandContractHash: 'c'.repeat(64),
}

const directions = generateDeterministicCreativeDirections({
  brief,
  brand: {},
  sources,
})

const plan = {
  schemaVersion: 1,
  siteType: 'standard',
  propertyId: '44444444-4444-4444-8444-444444444444',
  enabledCapabilities: [],
  name: 'Approved plan',
  summary: 'Approved summary',
  preferences: { motion: 'subtle', enabledCapabilities: [] },
  brandDirection: {
    positioning: 'Verified positioning',
    voice: 'Direct',
    visualDirection: 'Approved',
    mustInclude: [],
    mustAvoid: [],
  },
  audiences: [],
  pages: [
    {
      slug: 'home',
      title: 'Home',
      navLabel: 'Home',
      purpose: 'Introduce the property',
      sections: [
        {
          id: 'home-hero',
          label: 'Hero',
          purpose: 'Establish the property promise',
          block: 'acf/top-slides',
          variant: 'editorial',
          required: true,
          factsRequired: ['property name'],
          evidenceIds: ['brand'],
        },
        {
          id: 'home-gallery',
          label: 'Gallery',
          purpose: 'Show approved property imagery',
          block: 'acf/gallery',
          variant: 'masonry',
          required: false,
          factsRequired: [],
          evidenceIds: ['brand'],
        },
      ],
    },
  ],
  conversionStrategy: {
    primaryAction: 'tours',
    secondaryAction: 'contact',
    leadDestination: 'p11_lumaleasing',
    tourDestination: 'p11_lumaleasing',
    requiredForms: ['tour'],
  },
  floorPlanStrategy: {
    source: 'property_units',
    display: 'cards',
    showPricing: true,
    showAvailability: true,
    freshnessHours: 168,
  },
  seoStrategy: {
    localSearchFocus: [],
    structuredData: ['ApartmentComplex'],
  },
  analyticsStrategy: {
    enabled: false,
    consentMode: 'unconfigured',
    events: [],
  },
  accessibilityRequirements: [],
  legalRequirements: [],
  knownFacts: [],
  recommendations: [],
  unresolvedQuestions: [],
  evidence: [],
} satisfies SiteForgePlan

const baseDesignSystem: DesignSystem = {
  colorSystem: {
    primary: '#000000',
    secondary: '#111111',
    accent: '#222222',
    background: '#ffffff',
    strategy: 'custom',
    reasoning: 'base',
  },
  typography: {
    headingFont: 'Base',
    headingWeight: 500,
    bodyFont: 'Base',
    scale: 'balanced',
    strategy: 'custom',
    reasoning: 'base',
  },
  spacing: {
    scale: 'balanced',
    containerMaxWidth: '1200px',
    sectionPadding: '4rem',
    reasoning: 'base',
  },
  componentStyles: {
    hero: { layout: 'centered', variant: 'editorial', treatment: 'minimal', reasoning: 'base' },
    amenityShowcase: { layout: 'grid', variant: 'editorial', treatment: 'mixed', reasoning: 'base' },
    ctaSections: { layout: 'inline', variant: 'inline', treatment: 'button', reasoning: 'base' },
  },
  animations: { level: 'none', types: [], reasoning: 'base' },
}

function execution(index: number): SiteForgeCreativeExecutionContext {
  return { brief, direction: directions[index].direction }
}

function topology(architecture: ReturnType<typeof composeApprovedSiteForgeArchitecture>) {
  return architecture.pages.map(page => ({
    slug: page.slug,
    title: page.title,
    sections: page.sections.map(section => ({
      id: section.id,
      block: section.block,
      order: section.order,
    })),
  }))
}

describe('approved SiteForge creative execution', () => {
  it('changes constrained composition while preserving exact approved topology', () => {
    const editorial = composeApprovedSiteForgeArchitecture(plan, execution(0))
    const immersive = composeApprovedSiteForgeArchitecture(plan, execution(2))

    expect(editorial.pages[0].sections.map(section => section.variant)).toEqual([
      'split',
      'masonry',
    ])
    expect(immersive.pages[0].sections.map(section => section.variant)).toEqual([
      'cinematic',
      'full-bleed',
    ])
    expect(topology(editorial)).toEqual(topology(immersive))
    expect(topology(editorial)).toEqual([
      {
        slug: 'home',
        title: 'Home',
        sections: [
          { id: 'home-hero', block: 'acf/top-slides', order: 0 },
          { id: 'home-gallery', block: 'acf/gallery', order: 1 },
        ],
      },
    ])
    expect(editorial.pages[0].sections[0].fields).toMatchObject({
      approvedObjective: 'Increase qualified tour requests',
      approvedAudience: 'Prospective residents',
      compositionProfile: 'editorial',
    })
    expect(() => assertRegisteredSiteForgeArchitecture(editorial)).not.toThrow()
    expect(() => assertRegisteredSiteForgeArchitecture(immersive)).not.toThrow()
  })

  it('fails closed on blocks or variants outside the registered ACF surface', () => {
    const architecture = composeApprovedSiteForgeArchitecture(plan, execution(0))
    architecture.pages[0].sections[0].block = 'acf/arbitrary-runtime'

    expect(() => assertRegisteredSiteForgeArchitecture(architecture)).toThrow(
      'unregistered block'
    )
  })

  it('materially drives design, content voice, and photo strategy', () => {
    const editorial = execution(0)
    const immersive = execution(2)
    const editorialDesign = applyApprovedCreativeDirectionToDesignSystem(
      baseDesignSystem,
      editorial
    )
    const immersiveDesign = applyApprovedCreativeDirectionToDesignSystem(
      baseDesignSystem,
      immersive
    )
    const photoStrategy: PhotoStrategy = {
      uploadedPhotoUsage: [],
      photosToGenerate: [
        {
          category: 'hero',
          scene: 'Property arrival',
          prompt: 'Approved property photography',
          priority: 'high',
          reasoning: 'Hero coverage',
        },
      ],
      photoGuidelines: {
        lighting: 'base',
        composition: 'base',
        subjects: 'base',
        mood: 'base',
      },
    }

    expect(editorialDesign.colorSystem.primary).toBe(
      editorial.direction.palette.primary
    )
    expect(immersiveDesign.colorSystem.primary).toBe(
      immersive.direction.palette.primary
    )
    expect(editorialDesign.componentStyles.hero).not.toEqual(
      immersiveDesign.componentStyles.hero
    )
    expect(editorialDesign.customCSS).toMatchObject({ needed: false, css: '' })
    expect(buildApprovedContentGuidance(editorial)).not.toBe(
      buildApprovedContentGuidance(immersive)
    )
    expect(
      applyApprovedDirectionToPhotoStrategy(photoStrategy, editorial)
        .photoGuidelines
    ).not.toEqual(
      applyApprovedDirectionToPhotoStrategy(photoStrategy, immersive)
        .photoGuidelines
    )
  })
})
