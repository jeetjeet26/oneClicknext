import type {
  ArchitectureProposal,
  SectionSpec,
} from '@/utils/siteforge/agents/architecture-agent'
import {
  siteForgeBriefSchema,
  type SiteForgeBrief,
} from '@/utils/siteforge/briefs/contracts'
import type { SiteForgePlan } from '@/utils/siteforge/contracts'
import {
  siteForgeCreativeDirectionSchema,
  type SiteForgeCreativeDirection,
} from '@/utils/siteforge/directions/contracts'
import {
  ACF_BLOCK_TYPES,
  SITEFORGE_BLOCK_CAPABILITIES,
  type ACFBlockType,
} from '@/types/siteforge'

export type SiteForgeCreativeExecutionContext = {
  brief: SiteForgeBrief
  direction: SiteForgeCreativeDirection
}

type CompositionProfile = 'editorial' | 'conversion' | 'immersive'

const PROFILE_VARIANTS = {
  editorial: {
    'acf/menu': 'standard',
    'acf/top-slides': 'split',
    'acf/text-section': 'editorial',
    'acf/feature-section': 'alternating',
    'acf/image': 'contained',
    'acf/links': 'inline',
    'acf/content-grid': 'editorial',
    'acf/form': 'split',
    'acf/map': 'standard',
    'acf/html-section': 'contained',
    'acf/gallery': 'masonry',
    'acf/accordion-section': 'bordered',
    'acf/plans-availability': 'details',
    'acf/poi': 'editorial',
    'acf/testimonials': 'spotlight',
  },
  conversion: {
    'acf/menu': 'sticky-cta',
    'acf/top-slides': 'minimal',
    'acf/text-section': 'lead',
    'acf/feature-section': 'compact',
    'acf/image': 'contained',
    'acf/links': 'sticky',
    'acf/content-grid': 'bento',
    'acf/form': 'card',
    'acf/map': 'standard',
    'acf/html-section': 'contained',
    'acf/gallery': 'categorized',
    'acf/accordion-section': 'minimal',
    'acf/plans-availability': 'cards',
    'acf/poi': 'map-list',
    'acf/testimonials': 'cards',
  },
  immersive: {
    'acf/menu': 'standard',
    'acf/top-slides': 'cinematic',
    'acf/text-section': 'contained',
    'acf/feature-section': 'bleed',
    'acf/image': 'full-bleed',
    'acf/links': 'banner',
    'acf/content-grid': 'carousel',
    'acf/form': 'minimal',
    'acf/map': 'immersive',
    'acf/html-section': 'full-width',
    'acf/gallery': 'full-bleed',
    'acf/accordion-section': 'minimal',
    'acf/plans-availability': 'details',
    'acf/poi': 'narrative',
    'acf/testimonials': 'carousel',
  },
} as const satisfies Record<
  CompositionProfile,
  Record<ACFBlockType, string>
>

const PHOTO_CATEGORIES: Partial<
  Record<ACFBlockType, 'hero' | 'amenity' | 'lifestyle' | 'gallery'>
> = {
  'acf/top-slides': 'hero',
  'acf/feature-section': 'lifestyle',
  'acf/image': 'gallery',
  'acf/content-grid': 'amenity',
  'acf/gallery': 'gallery',
  'acf/poi': 'lifestyle',
  'acf/testimonials': 'lifestyle',
}

export function parseSiteForgeCreativeExecutionContext(input: {
  approvedBrief: unknown
  approvedCreativeDirection: unknown
}): SiteForgeCreativeExecutionContext {
  return {
    brief: siteForgeBriefSchema.parse(input.approvedBrief),
    direction: siteForgeCreativeDirectionSchema.parse(
      input.approvedCreativeDirection
    ),
  }
}

export function siteForgeCompositionProfile(
  direction: SiteForgeCreativeDirection
): CompositionProfile {
  const structuralCues = [
    direction.rationale,
    direction.hero.composition,
    direction.layout.system,
    direction.layout.density,
    direction.cta.placement,
  ]
    .join(' ')
    .toLowerCase()

  if (
    /\b(immersive|cinematic|full[- ]?(?:width|viewport)|experiential|panoramic|atmospher)/.test(
      structuralCues
    )
  ) {
    return 'immersive'
  }
  if (
    /\b(conversion|information[- ]?(?:led|rich)|utility|persistent|availability|modular card|rapid scan)/.test(
      structuralCues
    )
  ) {
    return 'conversion'
  }
  return 'editorial'
}

export function approvedVariantForBlock(
  block: ACFBlockType,
  direction: SiteForgeCreativeDirection
): string {
  const variant = PROFILE_VARIANTS[siteForgeCompositionProfile(direction)][block]
  if (
    !(SITEFORGE_BLOCK_CAPABILITIES[block].variants as readonly string[]).includes(
      variant
    )
  ) {
    throw new Error(`Creative composition selected unsupported ${block} variant`)
  }
  return variant
}

function photoRequirement(
  section: SiteForgePlan['pages'][number]['sections'][number],
  direction: SiteForgeCreativeDirection
): SectionSpec['photoRequirement'] {
  const category = PHOTO_CATEGORIES[section.block]
  if (!category) return undefined
  const subject =
    direction.imagery.subjects[
      section.id.length % direction.imagery.subjects.length
    ]
  return {
    category,
    scene: `${subject}; ${section.purpose}; ${direction.imagery.style}; ${direction.imagery.treatment}`,
    priority:
      section.block === 'acf/top-slides'
        ? 'high'
        : section.required
          ? 'medium'
          : 'low',
  }
}

/**
 * Projects the approved plan without changing page, section, or block identity.
 * Creative direction is allowed to select only registered variants and fields.
 */
export function composeApprovedSiteForgeArchitecture(
  confirmedPlan: SiteForgePlan,
  execution: SiteForgeCreativeExecutionContext
): ArchitectureProposal {
  const { brief, direction } = execution
  const primaryObjective = brief.objectives.find(
    objective => objective.priority === 'primary'
  ) || brief.objectives[0]
  const primaryAudience = brief.audiences[0]
  const profile = siteForgeCompositionProfile(direction)

  return {
    navigation: {
      structure:
        profile === 'conversion'
          ? 'primary'
          : confirmedPlan.pages.length <= 2
            ? 'minimal'
            : 'primary',
      items: confirmedPlan.pages.map((page, index) => ({
        label: page.navLabel,
        slug: page.slug,
        priority: index === 0 ? 'high' : 'medium',
      })),
      reasoning:
        'Exact navigation topology from the confirmed plan, composed using the approved creative direction.',
    },
    pages: confirmedPlan.pages.map((page, pageIndex) => ({
      slug: page.slug,
      title: page.title,
      purpose: page.purpose,
      priority: pageIndex === 0 ? 'high' : 'medium',
      sections: page.sections.map((section, sectionIndex) => ({
        id: section.id,
        type: section.label,
        label: section.label,
        purpose: section.purpose,
        block: section.block,
        variant: approvedVariantForBlock(section.block, direction),
        fields: {
          factsRequired: section.factsRequired,
          evidenceIds: section.evidenceIds,
          required: section.required,
          compositionProfile: profile,
          approvedObjective: primaryObjective.statement,
          approvedSuccessSignal: primaryObjective.successSignal,
          approvedAudience: primaryAudience.segment,
          approvedAudienceNeeds: primaryAudience.needs,
          approvedVoiceTraits: direction.voice.traits,
          approvedHeadlineStyle: direction.hero.headlineStyle,
          approvedCtaStyle: direction.cta.style,
        },
        photoRequirement: photoRequirement(section, direction),
        reasoning:
          `Exact confirmed section topology with approved ${profile} composition; ` +
          `supports "${primaryObjective.statement}" for ${primaryAudience.segment}.`,
        order: sectionIndex,
      })),
    })),
    conversionStrategy: {
      primaryCTA: direction.cta.label,
      ctaPlacement: [direction.cta.placement],
      reasoning:
        `Approved brief action "${brief.conversion.primaryAction}" executed with the approved direction's CTA treatment.`,
    },
  }
}

export function assertRegisteredSiteForgeArchitecture(
  architecture: ArchitectureProposal
): void {
  const registeredBlocks = new Set<string>(ACF_BLOCK_TYPES)
  for (const page of architecture.pages) {
    for (const section of page.sections) {
      if (!registeredBlocks.has(section.block)) {
        throw new Error(`Creative composition used unregistered block ${section.block}`)
      }
      const block = section.block as ACFBlockType
      if (
        !section.variant ||
        !(SITEFORGE_BLOCK_CAPABILITIES[block].variants as readonly string[]).includes(
          section.variant
        )
      ) {
        throw new Error(
          `Creative composition used unsupported ${section.block} variant ${section.variant || '(missing)'}`
        )
      }
    }
  }
}
