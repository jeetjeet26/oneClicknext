import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import type { ACFBlockType } from '@/types/siteforge'
import {
  VERTICAL_LIFECYCLES,
  VERTICAL_SCOPES,
  VERTICAL_SECTORS,
  VERTICAL_TRANSACTIONS,
  type VerticalAnalyticsOutcome,
  type VerticalCompositionRequest,
  type VerticalConversionIntent,
  type VerticalEvidenceKind,
  type VerticalLifecycle,
  type VerticalOfferingKind,
  type VerticalPack,
  type VerticalPackLayer,
  type VerticalPolicyCode,
  type VerticalScope,
  type VerticalSector,
  type VerticalSeoSchemaType,
  type VerticalTransaction,
  verticalPackSchema,
} from './contracts'

export const VERTICAL_REGISTRY_VERSION = 1

export const VERTICAL_ARCHETYPES = [
  'rental_multifamily',
  'for_sale_community',
  'senior_community',
  'commercial_property',
  'corporate',
  'portfolio',
  'destination',
] as const

export const VERTICAL_MODIFIERS = [
  'lease_up',
  'affordable',
  'student',
  'luxury',
  'build_to_rent',
  'mixed_use',
  'builder_corporate',
  'master_planned',
  'condo_townhome',
  'custom_home',
  'active_adult_55_plus',
  'branded_residence',
  'independent_living',
  'assisted_living',
  'memory_care',
  'life_plan_ccrc',
  'skilled_nursing',
  'office',
  'retail',
  'industrial_logistics',
  'life_science',
] as const

type VerticalArchetype = (typeof VERTICAL_ARCHETYPES)[number]
type VerticalModifier = (typeof VERTICAL_MODIFIERS)[number]

const allApplicability = {
  scopes: [...VERTICAL_SCOPES],
  sectors: [...VERTICAL_SECTORS],
  transactions: [...VERTICAL_TRANSACTIONS],
  archetypes: [...VERTICAL_ARCHETYPES],
  lifecycles: [...VERTICAL_LIFECYCLES],
}

// Section ids are sorted lexicographically during pack normalization, so
// section keys must sort in the intended visual order (primary first, then
// s2-*, s3-*, ...).
type PackSectionOption = {
  key: string
  blockKey: ACFBlockType
  purpose: string
  required?: boolean
}

type PackOptions = {
  layer: VerticalPackLayer
  selector: string
  label: string
  scopes?: VerticalScope[]
  sectors?: VerticalSector[]
  transactions?: VerticalTransaction[]
  archetypes?: VerticalArchetype[]
  lifecycles?: VerticalLifecycle[]
  evidenceKind?: VerticalEvidenceKind
  optionalEvidenceKind?: VerticalEvidenceKind
  question?: string
  page?: {
    slug: string
    title: string
    blockKey: ACFBlockType
    purpose: string
    additionalSections?: PackSectionOption[]
  }
  additionalPages?: Array<{
    key: string
    slug: string
    title: string
    order?: number
    required?: boolean
    sections: PackSectionOption[]
  }>
  offeringKinds?: VerticalOfferingKind[]
  intent?: VerticalConversionIntent
  fallbackIntent?: VerticalConversionIntent | null
  outcome?: VerticalAnalyticsOutcome
  additionalConversions?: Array<{
    id: string
    intent: VerticalConversionIntent
    outcome: VerticalAnalyticsOutcome
    fallbackIntent?: VerticalConversionIntent | null
  }>
  seo?: VerticalSeoSchemaType[]
  policies?: VerticalPolicyCode[]
  forbiddenClaims?: string[]
  freshness?: {
    evidenceKind: VerticalEvidenceKind
    maxAgeHours: number
    onStale:
      | 'block'
      | 'hide_volatile_fields'
      | 'fallback_to_inquiry'
      | 'require_confirmation'
  }
  additionalFreshness?: Array<{
    id: string
    evidenceKind: VerticalEvidenceKind
    maxAgeHours: number
    onStale:
      | 'block'
      | 'hide_volatile_fields'
      | 'fallback_to_inquiry'
      | 'require_confirmation'
  }>
  lifecycleOverride?: {
    lifecycle: VerticalLifecycle
    preferredConversionIntent: VerticalConversionIntent
  }
  conflictsWith?: string[]
  exclusiveClaims?: string[]
}

function makePack(options: PackOptions): VerticalPack {
  const prefix = `${options.layer}.${options.selector}`
  const evidenceId = `${prefix}.evidence.required`
  const pageId = `${prefix}.page.primary`
  const intent = options.intent || 'inquiry'
  const outcome = options.outcome || 'qualified_inquiry'

  const toSection = (parentPageId: string) => (section: PackSectionOption) => ({
    id: `${parentPageId}.section.${section.key}`,
    blockKey: section.blockKey,
    purpose: section.purpose,
    required: section.required ?? true,
    conversionIntent: section.blockKey === 'acf/form' ? intent : null,
  })

  const pages = [
    ...(options.page
      ? [
          {
            id: pageId,
            slug: options.page.slug,
            title: options.page.title,
            order: 100,
            required: true,
            sections: [
              {
                id: `${pageId}.section.primary`,
                blockKey: options.page.blockKey,
                purpose: options.page.purpose,
                required: true,
                conversionIntent:
                  options.page.blockKey === 'acf/form' ? intent : null,
              },
              ...(options.page.additionalSections || []).map(
                toSection(pageId)
              ),
            ],
          },
        ]
      : []),
    ...(options.additionalPages || []).map((page, index) => {
      const extraPageId = `${prefix}.page.${page.key}`
      return {
        id: extraPageId,
        slug: page.slug,
        title: page.title,
        order: page.order ?? 120 + index * 10,
        required: page.required ?? true,
        sections: page.sections.map(toSection(extraPageId)),
      }
    }),
  ]

  return verticalPackSchema.parse({
    schemaVersion: 1,
    key: `siteforge.vertical.${options.layer}.${options.selector}`,
    version: VERTICAL_REGISTRY_VERSION,
    layer: options.layer,
    selector: options.selector,
    label: options.label,
    applicability: {
      scopes: options.scopes || allApplicability.scopes,
      sectors: options.sectors || allApplicability.sectors,
      transactions: options.transactions || allApplicability.transactions,
      archetypes: options.archetypes || allApplicability.archetypes,
      lifecycles: options.lifecycles || allApplicability.lifecycles,
    },
    requiredEvidence: [
      {
        id: evidenceId,
        kind: options.evidenceKind || 'subject_identity',
        description: `Verified ${options.label.toLowerCase()} source truth.`,
        maxAgeHours:
          options.evidenceKind === 'availability' ||
          options.evidenceKind === 'pricing'
            ? 24
            : null,
      },
    ],
    optionalEvidence: [
      {
        id: `${prefix}.evidence.optional`,
        kind: options.optionalEvidenceKind || 'brand',
        description: `Optional supporting evidence for ${options.label.toLowerCase()}.`,
        maxAgeHours: null,
      },
    ],
    decisionIds: [`${prefix}.decision.confirm`],
    questionIds: [
      options.question || `${prefix}.question.confirm_applicability`,
    ],
    pages,
    offeringKinds: options.offeringKinds || [],
    conversionIntentRecipes: [
      {
        id: `${prefix}.conversion.primary`,
        intent,
        requiredEvidenceIds: [evidenceId],
        fallbackIntent:
          options.fallbackIntent === undefined
            ? intent === 'inquiry'
              ? null
              : 'inquiry'
            : options.fallbackIntent,
        successOutcome: outcome,
        sensitiveData:
          options.sectors?.includes('senior_care') &&
          intent === 'professional_referral'
            ? 'regulated'
            : 'contact',
      },
      ...(options.additionalConversions || []).map(conversion => ({
        id: `${prefix}.conversion.${conversion.id}`,
        intent: conversion.intent,
        requiredEvidenceIds: [evidenceId],
        fallbackIntent:
          conversion.fallbackIntent === undefined
            ? 'inquiry'
            : conversion.fallbackIntent,
        successOutcome: conversion.outcome,
        sensitiveData: 'contact' as const,
      })),
    ],
    seoSchemaTypes: options.seo || ['WebPage', 'BreadcrumbList'],
    policyCodes: options.policies || ['privacy_consent', 'wcag_2_2_aa'],
    forbiddenClaims:
      options.forbiddenClaims || [`${prefix}.claim.unsourced_material_fact`],
    analyticsOutcomes: [
      {
        id: `${prefix}.analytics.primary`,
        outcome,
        eventName: `siteforge.${options.selector}.${outcome}`,
        northStar: true,
      },
    ],
    freshnessRules: [
      options.freshness
        ? {
            id: `${prefix}.freshness.primary`,
            ...options.freshness,
          }
        : {
            id: `${prefix}.freshness.primary`,
            evidenceKind: options.evidenceKind || 'subject_identity',
            maxAgeHours: 8_760,
            onStale: 'require_confirmation',
          },
      ...(options.additionalFreshness || []).map(rule => ({
        id: `${prefix}.freshness.${rule.id}`,
        evidenceKind: rule.evidenceKind,
        maxAgeHours: rule.maxAgeHours,
        onStale: rule.onStale,
      })),
    ],
    lifecycleOverrides: options.lifecycleOverride
      ? [
          {
            id: `${prefix}.lifecycle.${options.lifecycleOverride.lifecycle}`,
            lifecycle: options.lifecycleOverride.lifecycle,
            activatePageIds: pages.map(page => page.id),
            deactivatePageIds: [],
            requiredEvidenceIds: [evidenceId],
            preferredConversionIntent:
              options.lifecycleOverride.preferredConversionIntent,
          },
        ]
      : [],
    conflictsWith: options.conflictsWith || [],
    exclusiveClaims: options.exclusiveClaims || [],
  })
}

const CORE_PACKS = [
  makePack({
    layer: 'core',
    selector: 'real_estate',
    label: 'Real-estate core',
    page: {
      slug: '/',
      title: 'Home',
      blockKey: 'acf/top-slides',
      purpose: 'Introduce the verified subject and its primary visitor outcome.',
      additionalSections: [
        {
          key: 's2-positioning',
          blockKey: 'acf/text-section',
          purpose:
            'Establish the approved brand positioning and welcome narrative for the verified subject.',
        },
        {
          key: 's3-highlights',
          blockKey: 'acf/content-grid',
          purpose:
            'Showcase signature amenities and community highlights sourced from approved property truth.',
        },
        {
          key: 's4-lifestyle',
          blockKey: 'acf/feature-section',
          purpose:
            'Pair approved lifestyle photography with grounded brand voice to convey the living experience.',
        },
        {
          key: 's5-cta',
          blockKey: 'acf/links',
          purpose:
            'Direct visitors to the primary conversion path and the most important interior pages.',
        },
      ],
    },
    seo: ['WebPage', 'BreadcrumbList'],
    policies: ['privacy_consent', 'wcag_2_2_aa'],
    exclusiveClaims: ['core.real_estate'],
  }),
]

const SCOPE_PACKS = (
  [
    ['property', 'Property scope'],
    ['community', 'Community scope'],
    ['development', 'Development scope'],
    ['corporate', 'Corporate scope'],
    ['portfolio', 'Portfolio scope'],
    ['destination', 'Destination scope'],
  ] as const
).map(([selector, label]) =>
  makePack({
    layer: 'scope',
    selector,
    label,
    scopes: [selector],
    evidenceKind:
      selector === 'portfolio' ? 'portfolio_membership' : 'subject_identity',
    page:
      selector === 'portfolio'
        ? {
            slug: '/properties',
            title: 'Properties',
            blockKey: 'acf/entity-directory',
            purpose: 'Present verified portfolio members and destinations.',
          }
        : selector === 'destination'
          ? {
              slug: '/explore',
              title: 'Explore',
              blockKey: 'acf/entity-directory',
              purpose: 'Present verified places, venues, and experiences.',
            }
          : undefined,
    offeringKinds:
      selector === 'portfolio'
        ? ['portfolio_property']
        : selector === 'destination'
          ? ['venue', 'event']
          : [],
    seo:
      selector === 'corporate'
        ? ['Organization', 'WebPage']
        : selector === 'destination'
          ? ['Place', 'WebPage']
          : ['WebPage', 'BreadcrumbList'],
    exclusiveClaims: ['dimension.scope'],
  })
)

const SECTOR_PACKS = (
  [
    ['residential', 'Residential sector'],
    ['senior_care', 'Senior-care sector'],
    ['commercial', 'Commercial sector'],
    ['cross_sector', 'Cross-sector'],
    ['destination', 'Destination sector'],
  ] as const
).map(([selector, label]) =>
  makePack({
    layer: 'sector',
    selector,
    label,
    sectors: [selector],
    evidenceKind: selector === 'senior_care' ? 'licensing' : 'subject_identity',
    seo:
      selector === 'senior_care'
        ? ['SeniorLiving', 'LocalBusiness', 'WebPage']
        : selector === 'commercial'
          ? ['LocalBusiness', 'Place', 'WebPage']
          : ['WebPage', 'BreadcrumbList'],
    policies:
      selector === 'senior_care'
        ? [
            'care_licensing_services',
            'health_data_minimization',
            'privacy_consent',
            'wcag_2_2_aa',
          ]
        : selector === 'residential'
          ? [
              'fair_housing',
              'equal_housing_opportunity',
              'privacy_consent',
              'wcag_2_2_aa',
            ]
          : ['privacy_consent', 'wcag_2_2_aa'],
    exclusiveClaims: ['dimension.sector'],
  })
)

const TRANSACTION_CONFIGS: Array<
  readonly [
    VerticalTransaction,
    string,
    VerticalConversionIntent,
    VerticalAnalyticsOutcome,
  ]
> = [
  ['rental', 'Rental transaction', 'apply', 'application_started'],
  ['for_sale', 'For-sale transaction', 'sales_inquiry', 'sales_lead_created'],
  [
    'care_services',
    'Care-services transaction',
    'private_appointment',
    'appointment_scheduled',
  ],
  [
    'commercial_lease',
    'Commercial lease transaction',
    'commercial_leasing_inquiry',
    'leasing_lead_created',
  ],
  ['informational', 'Informational transaction', 'inquiry', 'qualified_inquiry'],
  [
    'destination_booking',
    'Destination booking transaction',
    'external_booking',
    'booking_started',
  ],
]

const TRANSACTION_PACKS = TRANSACTION_CONFIGS.map(
  ([selector, label, intent, outcome]) =>
    makePack({
      layer: 'transaction',
      selector,
      label,
      transactions: [selector],
      intent,
      outcome,
      evidenceKind:
        selector === 'rental' || selector === 'commercial_lease'
          ? 'availability'
          : 'subject_identity',
      policies:
        selector === 'rental'
          ? ['pricing_availability', 'fair_housing', 'privacy_consent']
          : selector === 'for_sale'
            ? [
                'pricing_availability',
                'financing_brokerage',
                'privacy_consent',
              ]
            : ['privacy_consent', 'wcag_2_2_aa'],
      page: {
        slug: '/contact',
        title:
          selector === 'destination_booking'
            ? 'Plan Your Visit'
            : selector === 'care_services'
              ? 'Connect'
              : 'Contact',
        blockKey: 'acf/form',
        purpose: `Provide the approved ${intent.replaceAll('_', ' ')} conversion path.`,
      },
      exclusiveClaims: ['dimension.transaction'],
    })
)

const ARCHETYPE_PACKS = [
  makePack({
    layer: 'archetype',
    selector: 'rental_multifamily',
    label: 'Rental multifamily',
    sectors: ['residential', 'cross_sector'],
    transactions: ['rental'],
    archetypes: ['rental_multifamily'],
    evidenceKind: 'offering_catalog',
    page: {
      slug: '/floor-plans',
      title: 'Floor Plans',
      blockKey: 'acf/offering-browser',
      purpose: 'Present sourced rental offerings and current availability.',
    },
    additionalPages: [
      {
        key: 'amenities',
        slug: '/amenities',
        title: 'Amenities',
        order: 120,
        sections: [
          {
            key: 'primary',
            blockKey: 'acf/feature-section',
            purpose:
              'Introduce the community amenity experience with approved photography and brand voice.',
          },
          {
            key: 's2-grid',
            blockKey: 'acf/content-grid',
            purpose:
              'Present the full set of community and residence amenities sourced from approved property truth.',
          },
        ],
      },
      {
        key: 'gallery',
        slug: '/gallery',
        title: 'Gallery',
        order: 130,
        sections: [
          {
            key: 'primary',
            blockKey: 'acf/gallery',
            purpose:
              'Showcase approved property, amenity, and lifestyle photography in a curated gallery.',
          },
        ],
      },
      {
        key: 'neighborhood',
        slug: '/neighborhood',
        title: 'Neighborhood',
        order: 140,
        sections: [
          {
            key: 'primary',
            blockKey: 'acf/text-section',
            purpose:
              'Introduce the surrounding neighborhood using approved location facts and brand voice.',
          },
          {
            key: 's2-poi',
            blockKey: 'acf/poi',
            purpose:
              'Highlight verified nearby destinations, conveniences, and points of interest.',
          },
        ],
      },
    ],
    offeringKinds: ['rental_unit'],
    intent: 'tour',
    outcome: 'tour_scheduled',
    seo: ['ApartmentComplex', 'Residence', 'WebPage'],
    policies: [
      'fair_housing',
      'equal_housing_opportunity',
      'pricing_availability',
    ],
    freshness: {
      evidenceKind: 'availability',
      maxAgeHours: 24,
      onStale: 'fallback_to_inquiry',
    },
    exclusiveClaims: ['dimension.archetype'],
  }),
  makePack({
    layer: 'archetype',
    selector: 'for_sale_community',
    label: 'For-sale community',
    sectors: ['residential'],
    transactions: ['for_sale'],
    archetypes: ['for_sale_community'],
    evidenceKind: 'offering_catalog',
    page: {
      slug: '/homes',
      title: 'Homes',
      blockKey: 'acf/offering-browser',
      purpose: 'Present sourced home plans, homesites, and available homes.',
    },
    additionalPages: [
      {
        key: 'amenities',
        slug: '/amenities',
        title: 'Amenities',
        order: 120,
        sections: [
          {
            key: 'primary',
            blockKey: 'acf/feature-section',
            purpose:
              'Introduce the community amenity experience with approved photography and brand voice.',
          },
          {
            key: 's2-grid',
            blockKey: 'acf/content-grid',
            purpose:
              'Present the full set of community amenities sourced from approved property truth.',
          },
        ],
      },
      {
        key: 'gallery',
        slug: '/gallery',
        title: 'Gallery',
        order: 130,
        sections: [
          {
            key: 'primary',
            blockKey: 'acf/gallery',
            purpose:
              'Showcase approved community, home, and lifestyle photography in a curated gallery.',
          },
        ],
      },
      {
        key: 'neighborhood',
        slug: '/neighborhood',
        title: 'Neighborhood',
        order: 140,
        sections: [
          {
            key: 'primary',
            blockKey: 'acf/text-section',
            purpose:
              'Introduce the surrounding area using approved location facts and brand voice.',
          },
          {
            key: 's2-poi',
            blockKey: 'acf/poi',
            purpose:
              'Highlight verified nearby destinations, schools, and points of interest.',
          },
        ],
      },
    ],
    offeringKinds: ['home_plan', 'quick_move_in_home', 'homesite'],
    intent: 'sales_inquiry',
    outcome: 'sales_lead_created',
    additionalConversions: [
      {
        id: 'registration',
        intent: 'register_interest',
        outcome: 'registration_completed',
      },
      {
        id: 'appointment',
        intent: 'visit',
        outcome: 'appointment_scheduled',
      },
      {
        id: 'brochure',
        intent: 'brochure_request',
        outcome: 'brochure_requested',
      },
      {
        id: 'broker',
        intent: 'broker_registration',
        outcome: 'broker_registered',
        fallbackIntent: 'sales_inquiry',
      },
    ],
    seo: ['SingleFamilyResidence', 'Residence', 'WebPage'],
    policies: [
      'pricing_availability',
      'renderings_construction',
      'financing_brokerage',
    ],
    freshness: {
      evidenceKind: 'availability',
      maxAgeHours: 24,
      onStale: 'fallback_to_inquiry',
    },
    additionalFreshness: [
      {
        id: 'pricing',
        evidenceKind: 'pricing',
        maxAgeHours: 24,
        onStale: 'hide_volatile_fields',
      },
      {
        id: 'construction',
        evidenceKind: 'construction_status',
        maxAgeHours: 168,
        onStale: 'require_confirmation',
      },
    ],
    exclusiveClaims: ['dimension.archetype'],
  }),
  makePack({
    layer: 'archetype',
    selector: 'senior_community',
    label: 'Senior community',
    sectors: ['senior_care'],
    transactions: ['care_services'],
    archetypes: ['senior_community'],
    evidenceKind: 'services',
    page: {
      slug: '/living-options',
      title: 'Living Options',
      blockKey: 'acf/comparison-table',
      purpose: 'Describe sourced care and living services without suitability claims.',
    },
    offeringKinds: ['care_residence'],
    intent: 'private_appointment',
    outcome: 'appointment_scheduled',
    seo: ['SeniorLiving', 'Residence', 'WebPage'],
    policies: [
      'care_licensing_services',
      'health_data_minimization',
      'privacy_consent',
    ],
    forbiddenClaims: [
      'archetype.senior_community.claim.medical_suitability',
      'archetype.senior_community.claim.guaranteed_care_outcome',
    ],
    exclusiveClaims: ['dimension.archetype'],
  }),
  makePack({
    layer: 'archetype',
    selector: 'commercial_property',
    label: 'Commercial property',
    sectors: ['commercial'],
    transactions: ['commercial_lease'],
    archetypes: ['commercial_property'],
    evidenceKind: 'commercial_specifications',
    page: {
      slug: '/availability',
      title: 'Availability',
      blockKey: 'acf/offering-browser',
      purpose: 'Present sourced commercial spaces and specifications.',
    },
    offeringKinds: ['commercial_suite', 'commercial_building', 'land'],
    intent: 'commercial_leasing_inquiry',
    outcome: 'leasing_lead_created',
    seo: ['LocalBusiness', 'Place', 'WebPage'],
    policies: ['commercial_specifications', 'pricing_availability'],
    freshness: {
      evidenceKind: 'availability',
      maxAgeHours: 24,
      onStale: 'fallback_to_inquiry',
    },
    exclusiveClaims: ['dimension.archetype'],
  }),
  makePack({
    layer: 'archetype',
    selector: 'corporate',
    label: 'Corporate real estate',
    scopes: ['corporate'],
    transactions: ['for_sale', 'informational'],
    archetypes: ['corporate'],
    page: {
      slug: '/about',
      title: 'About',
      blockKey: 'acf/entity-directory',
      purpose: 'Describe the verified organization, capabilities, and markets.',
    },
    offeringKinds: ['portfolio_property'],
    intent: 'inquiry',
    seo: ['Organization', 'WebPage'],
    policies: ['investor_claims', 'privacy_consent', 'wcag_2_2_aa'],
    exclusiveClaims: ['dimension.archetype'],
  }),
  makePack({
    layer: 'archetype',
    selector: 'portfolio',
    label: 'Real-estate portfolio',
    scopes: ['portfolio'],
    sectors: ['cross_sector'],
    transactions: ['informational'],
    archetypes: ['portfolio'],
    evidenceKind: 'portfolio_membership',
    offeringKinds: ['portfolio_property'],
    intent: 'inquiry',
    seo: ['Organization', 'ItemList', 'WebPage'],
    policies: ['investor_claims', 'privacy_consent', 'wcag_2_2_aa'],
    exclusiveClaims: ['dimension.archetype'],
  }),
  makePack({
    layer: 'archetype',
    selector: 'destination',
    label: 'Real-estate destination',
    scopes: ['destination'],
    sectors: ['destination'],
    transactions: ['destination_booking'],
    archetypes: ['destination'],
    evidenceKind: 'destination_programming',
    page: {
      slug: '/events',
      title: 'Events',
      blockKey: 'acf/events-directory',
      purpose: 'Present sourced destination events and experiences.',
    },
    offeringKinds: ['venue', 'event'],
    intent: 'external_booking',
    outcome: 'booking_started',
    seo: ['Place', 'EventVenue', 'Event', 'WebPage'],
    policies: ['privacy_consent', 'wcag_2_2_aa'],
    freshness: {
      evidenceKind: 'destination_programming',
      maxAgeHours: 168,
      onStale: 'hide_volatile_fields',
    },
    exclusiveClaims: ['dimension.archetype'],
  }),
]

type ModifierConfig = Omit<PackOptions, 'layer' | 'selector' | 'label'> & {
  selector: VerticalModifier
  label: string
}

const MODIFIER_CONFIGS: ModifierConfig[] = [
  {
    selector: 'lease_up',
    label: 'Lease-up',
    archetypes: ['rental_multifamily'],
    lifecycles: ['prelaunch', 'lease_up'],
    evidenceKind: 'construction_status',
    intent: 'register_interest',
    outcome: 'registration_completed',
    policies: ['renderings_construction', 'pricing_availability'],
    forbiddenClaims: ['modifier.lease_up.claim.ready_now_without_evidence'],
    page: {
      slug: '/development-timeline',
      title: 'Development Timeline',
      blockKey: 'acf/timeline',
      purpose: 'Present sourced construction and opening milestones.',
    },
    freshness: {
      evidenceKind: 'construction_status',
      maxAgeHours: 168,
      onStale: 'block',
    },
  },
  {
    selector: 'affordable',
    label: 'Affordable housing',
    archetypes: ['rental_multifamily'],
    evidenceKind: 'eligibility',
    page: {
      slug: '/eligibility',
      title: 'Eligibility',
      blockKey: 'acf/document-library',
      purpose: 'Explain sourced eligibility and waitlist rules without promises.',
    },
    offeringKinds: ['rental_unit'],
    intent: 'waitlist',
    outcome: 'waitlist_joined',
    seo: ['ApartmentComplex', 'FAQPage', 'WebPage'],
    policies: [
      'affordable_eligibility_waitlist',
      'fair_housing',
      'equal_housing_opportunity',
    ],
    forbiddenClaims: ['modifier.affordable.claim.guaranteed_eligibility'],
  },
  {
    selector: 'student',
    label: 'Student housing',
    archetypes: ['rental_multifamily'],
    evidenceKind: 'offering_catalog',
    offeringKinds: ['bed_space'],
    intent: 'apply',
    outcome: 'application_started',
    seo: ['Residence', 'WebPage'],
    policies: ['fair_housing', 'privacy_consent', 'pricing_availability'],
    forbiddenClaims: [
      'modifier.student.claim.school_endorsement',
      'modifier.student.claim.safety_guarantee',
    ],
  },
  {
    selector: 'luxury',
    label: 'Luxury positioning',
    archetypes: ['rental_multifamily'],
    evidenceKind: 'amenities',
    intent: 'private_appointment',
    outcome: 'appointment_scheduled',
    seo: ['ApartmentComplex', 'Residence', 'WebPage'],
    policies: ['fair_housing', 'pricing_availability'],
    forbiddenClaims: ['modifier.luxury.claim.unsourced_superlative'],
    conflictsWith: ['siteforge.vertical.modifier.affordable'],
  },
  {
    selector: 'build_to_rent',
    label: 'Build-to-rent',
    archetypes: ['rental_multifamily'],
    evidenceKind: 'offering_catalog',
    offeringKinds: ['rental_home'],
    intent: 'tour',
    outcome: 'tour_scheduled',
    seo: ['SingleFamilyResidence', 'Residence', 'WebPage'],
    policies: ['fair_housing', 'pricing_availability'],
  },
  {
    selector: 'mixed_use',
    label: 'Mixed-use',
    sectors: ['cross_sector'],
    archetypes: ['rental_multifamily'],
    evidenceKind: 'offering_catalog',
    offeringKinds: ['rental_unit', 'commercial_suite'],
    intent: 'inquiry',
    outcome: 'qualified_inquiry',
    seo: ['ApartmentComplex', 'LocalBusiness', 'Place', 'WebPage'],
    policies: [
      'fair_housing',
      'commercial_specifications',
      'pricing_availability',
    ],
  },
  {
    selector: 'builder_corporate',
    label: 'Homebuilder corporate',
    scopes: ['corporate'],
    archetypes: ['corporate'],
    evidenceKind: 'portfolio_membership',
    offeringKinds: ['portfolio_property', 'home_plan'],
    intent: 'sales_inquiry',
    outcome: 'sales_lead_created',
    seo: ['Organization', 'ItemList', 'WebPage'],
    policies: ['renderings_construction', 'financing_brokerage'],
  },
  {
    selector: 'master_planned',
    label: 'Master-planned community',
    scopes: ['development'],
    archetypes: ['for_sale_community'],
    evidenceKind: 'offering_catalog',
    offeringKinds: ['home_plan', 'quick_move_in_home', 'homesite'],
    intent: 'visit',
    outcome: 'appointment_scheduled',
    seo: ['Place', 'SingleFamilyResidence', 'ItemList', 'WebPage'],
    policies: ['renderings_construction', 'pricing_availability'],
  },
  {
    selector: 'condo_townhome',
    label: 'Condominium or townhome',
    archetypes: ['for_sale_community'],
    evidenceKind: 'offering_catalog',
    offeringKinds: ['home_plan', 'quick_move_in_home'],
    intent: 'sales_inquiry',
    outcome: 'sales_lead_created',
    seo: ['Residence', 'SingleFamilyResidence', 'WebPage'],
    policies: ['financing_brokerage', 'pricing_availability'],
  },
  {
    selector: 'custom_home',
    label: 'Custom-home builder',
    scopes: ['corporate'],
    archetypes: ['corporate'],
    evidenceKind: 'offering_catalog',
    offeringKinds: ['home_plan'],
    intent: 'private_appointment',
    outcome: 'appointment_scheduled',
    seo: ['Organization', 'SingleFamilyResidence', 'WebPage'],
    policies: ['renderings_construction', 'financing_brokerage'],
  },
  {
    selector: 'active_adult_55_plus',
    label: 'Active-adult 55-plus',
    archetypes: ['for_sale_community'],
    evidenceKind: 'eligibility',
    offeringKinds: ['home_plan', 'quick_move_in_home'],
    intent: 'visit',
    outcome: 'appointment_scheduled',
    seo: ['Residence', 'Place', 'WebPage'],
    policies: ['hopa_55_plus', 'fair_housing', 'financing_brokerage'],
    forbiddenClaims: ['modifier.active_adult_55_plus.claim.unverified_hopa'],
  },
  {
    selector: 'branded_residence',
    label: 'Branded residence',
    archetypes: ['for_sale_community'],
    evidenceKind: 'brand_license',
    offeringKinds: ['home_plan', 'quick_move_in_home'],
    intent: 'private_appointment',
    outcome: 'appointment_scheduled',
    seo: ['Residence', 'Organization', 'WebPage'],
    policies: [
      'brand_licensing',
      'financing_brokerage',
      'pricing_availability',
    ],
    forbiddenClaims: ['modifier.branded_residence.claim.unlicensed_brand_use'],
  },
  {
    selector: 'independent_living',
    label: 'Independent living',
    archetypes: ['senior_community'],
    evidenceKind: 'services',
    offeringKinds: ['care_residence'],
    intent: 'private_appointment',
    outcome: 'appointment_scheduled',
    seo: ['SeniorLiving', 'Residence', 'WebPage'],
    policies: ['care_licensing_services', 'health_data_minimization'],
  },
  {
    selector: 'assisted_living',
    label: 'Assisted living',
    archetypes: ['senior_community'],
    evidenceKind: 'licensing',
    offeringKinds: ['care_residence'],
    intent: 'private_appointment',
    outcome: 'appointment_scheduled',
    seo: ['SeniorLiving', 'LocalBusiness', 'WebPage'],
    policies: ['care_licensing_services', 'health_data_minimization'],
    forbiddenClaims: ['modifier.assisted_living.claim.medical_outcome'],
  },
  {
    selector: 'memory_care',
    label: 'Memory care',
    archetypes: ['senior_community'],
    evidenceKind: 'licensing',
    offeringKinds: ['care_residence'],
    intent: 'professional_referral',
    outcome: 'professional_referral_submitted',
    seo: ['SeniorLiving', 'LocalBusiness', 'WebPage'],
    policies: ['care_licensing_services', 'health_data_minimization'],
    forbiddenClaims: ['modifier.memory_care.claim.clinical_suitability'],
  },
  {
    selector: 'life_plan_ccrc',
    label: 'Life-plan or CCRC',
    archetypes: ['senior_community'],
    evidenceKind: 'licensing',
    offeringKinds: ['care_residence'],
    intent: 'private_appointment',
    outcome: 'appointment_scheduled',
    seo: ['SeniorLiving', 'Place', 'WebPage'],
    policies: ['care_licensing_services', 'health_data_minimization'],
    forbiddenClaims: ['modifier.life_plan_ccrc.claim.guaranteed_continuum'],
  },
  {
    selector: 'skilled_nursing',
    label: 'Skilled nursing',
    archetypes: ['senior_community'],
    evidenceKind: 'licensing',
    offeringKinds: ['care_residence'],
    intent: 'professional_referral',
    outcome: 'professional_referral_submitted',
    seo: ['SeniorLiving', 'LocalBusiness', 'WebPage'],
    policies: ['care_licensing_services', 'health_data_minimization'],
    forbiddenClaims: ['modifier.skilled_nursing.claim.medical_outcome'],
  },
  {
    selector: 'office',
    label: 'Office',
    archetypes: ['commercial_property'],
    evidenceKind: 'commercial_specifications',
    offeringKinds: ['commercial_suite', 'commercial_building'],
    intent: 'commercial_leasing_inquiry',
    outcome: 'leasing_lead_created',
    seo: ['OfficeBuilding', 'Place', 'WebPage'],
    policies: ['commercial_specifications', 'pricing_availability'],
  },
  {
    selector: 'retail',
    label: 'Retail',
    archetypes: ['commercial_property'],
    evidenceKind: 'commercial_specifications',
    offeringKinds: ['commercial_suite'],
    intent: 'commercial_leasing_inquiry',
    outcome: 'leasing_lead_created',
    seo: ['ShoppingCenter', 'LocalBusiness', 'WebPage'],
    policies: ['commercial_specifications', 'pricing_availability'],
  },
  {
    selector: 'industrial_logistics',
    label: 'Industrial or logistics',
    archetypes: ['commercial_property'],
    evidenceKind: 'commercial_specifications',
    offeringKinds: ['commercial_suite', 'commercial_building', 'land'],
    intent: 'commercial_leasing_inquiry',
    outcome: 'leasing_lead_created',
    seo: ['IndustrialBuilding', 'Place', 'WebPage'],
    policies: ['commercial_specifications', 'pricing_availability'],
  },
  {
    selector: 'life_science',
    label: 'Life science',
    archetypes: ['commercial_property'],
    evidenceKind: 'commercial_specifications',
    offeringKinds: ['commercial_suite', 'commercial_building'],
    intent: 'rfp',
    outcome: 'rfp_submitted',
    seo: ['OfficeBuilding', 'LocalBusiness', 'WebPage'],
    policies: ['commercial_specifications', 'pricing_availability'],
    forbiddenClaims: ['modifier.life_science.claim.unverified_lab_specification'],
  },
]

const MODIFIER_PACKS = MODIFIER_CONFIGS.map(config =>
  makePack({
    layer: 'modifier',
    ...config,
  })
)

const LIFECYCLE_PACKS = (
  [
    ['operating', 'Operating lifecycle', 'inquiry'],
    ['prelaunch', 'Prelaunch lifecycle', 'register_interest'],
    ['lease_up', 'Lease-up lifecycle', 'tour'],
    ['selling', 'Selling lifecycle', 'sales_inquiry'],
  ] as const
).map(([selector, label, intent]) =>
  makePack({
    layer: 'lifecycle',
    selector,
    label,
    lifecycles: [selector],
    evidenceKind:
      selector === 'prelaunch' || selector === 'lease_up'
        ? 'construction_status'
        : selector === 'selling'
          ? 'availability'
          : 'subject_identity',
    intent,
    outcome:
      selector === 'prelaunch'
        ? 'registration_completed'
        : selector === 'selling'
          ? 'sales_lead_created'
          : selector === 'lease_up'
            ? 'tour_scheduled'
            : 'qualified_inquiry',
    lifecycleOverride: {
      lifecycle: selector,
      preferredConversionIntent: intent,
    },
    exclusiveClaims: ['dimension.lifecycle'],
  })
)

export const SITEFORGE_VERTICAL_PACKS = [
  ...CORE_PACKS,
  ...SCOPE_PACKS,
  ...SECTOR_PACKS,
  ...TRANSACTION_PACKS,
  ...ARCHETYPE_PACKS,
  ...MODIFIER_PACKS,
  ...LIFECYCLE_PACKS,
] as const

function sortStrings<T extends string>(values: T[]): T[] {
  return [...values].sort((a, b) => a.localeCompare(b))
}

export function normalizeVerticalPack(pack: VerticalPack): VerticalPack {
  const parsed = verticalPackSchema.parse(pack)
  return {
    ...parsed,
    applicability: {
      scopes: sortStrings(parsed.applicability.scopes),
      sectors: sortStrings(parsed.applicability.sectors),
      transactions: sortStrings(parsed.applicability.transactions),
      archetypes: sortStrings(parsed.applicability.archetypes),
      lifecycles: sortStrings(parsed.applicability.lifecycles),
    },
    requiredEvidence: [...parsed.requiredEvidence].sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    optionalEvidence: [...parsed.optionalEvidence].sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    decisionIds: sortStrings(parsed.decisionIds),
    questionIds: sortStrings(parsed.questionIds),
    pages: [...parsed.pages]
      .map(page => ({
        ...page,
        sections: [...page.sections].sort((a, b) => a.id.localeCompare(b.id)),
      }))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    offeringKinds: sortStrings(parsed.offeringKinds),
    conversionIntentRecipes: [...parsed.conversionIntentRecipes].sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    seoSchemaTypes: sortStrings(parsed.seoSchemaTypes),
    policyCodes: sortStrings(parsed.policyCodes),
    forbiddenClaims: sortStrings(parsed.forbiddenClaims),
    analyticsOutcomes: [...parsed.analyticsOutcomes].sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    freshnessRules: [...parsed.freshnessRules].sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    lifecycleOverrides: [...parsed.lifecycleOverrides].sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    conflictsWith: sortStrings(parsed.conflictsWith),
    exclusiveClaims: sortStrings(parsed.exclusiveClaims),
  }
}

export function assertVerticalPackIntegrity(pack: VerticalPack): void {
  const ids = new Map<string, string>()
  const addId = (id: string, collection: string) => {
    const existing = ids.get(id)
    if (existing) {
      throw new Error(
        `DUPLICATE_DECLARATION: ${id} appears in ${existing} and ${collection}`
      )
    }
    ids.set(id, collection)
  }

  for (const id of pack.decisionIds) addId(id, 'decisionIds')
  for (const id of pack.questionIds) addId(id, 'questionIds')
  for (const item of pack.requiredEvidence) addId(item.id, 'requiredEvidence')
  for (const item of pack.optionalEvidence) addId(item.id, 'optionalEvidence')
  for (const page of pack.pages) {
    addId(page.id, 'pages')
    for (const section of page.sections) addId(section.id, 'pageSections')
  }
  for (const item of pack.conversionIntentRecipes) {
    addId(item.id, 'conversionIntentRecipes')
  }
  for (const item of pack.analyticsOutcomes) {
    addId(item.id, 'analyticsOutcomes')
  }
  for (const item of pack.freshnessRules) addId(item.id, 'freshnessRules')
  for (const item of pack.lifecycleOverrides) {
    addId(item.id, 'lifecycleOverrides')
  }

  const pagePaths = new Set<string>()
  for (const page of pack.pages) {
    if (pagePaths.has(page.slug)) {
      throw new Error(
        `PAGE_PATH_CONFLICT: ${page.slug} is declared more than once in ${pack.key}`
      )
    }
    pagePaths.add(page.slug)
  }

  const requiredEvidenceIds = new Set(
    pack.requiredEvidence.map(evidence => evidence.id)
  )
  for (const recipe of pack.conversionIntentRecipes) {
    for (const evidenceId of recipe.requiredEvidenceIds) {
      if (!requiredEvidenceIds.has(evidenceId)) {
        throw new Error(
          `UNKNOWN_DECLARATION_REFERENCE: ${recipe.id} references ${evidenceId}`
        )
      }
    }
  }
  for (const override of pack.lifecycleOverrides) {
    for (const evidenceId of override.requiredEvidenceIds) {
      if (!requiredEvidenceIds.has(evidenceId)) {
        throw new Error(
          `UNKNOWN_DECLARATION_REFERENCE: ${override.id} references ${evidenceId}`
        )
      }
    }
  }
}

export type RegisteredVerticalPack = VerticalPack & {
  contentHash: string
}

export class VerticalPackRegistry {
  readonly version: number
  private readonly packs: RegisteredVerticalPack[]

  constructor(version: number, packs: readonly VerticalPack[]) {
    this.version = version
    const identities = new Set<string>()
    const selectors = new Set<string>()

    this.packs = packs.map(rawPack => {
      const pack = normalizeVerticalPack(rawPack)
      assertVerticalPackIntegrity(pack)
      if (pack.version !== version) {
        throw new Error(
          `PACK_VERSION_MISMATCH: ${pack.key}@${pack.version} is not registry version ${version}`
        )
      }
      const identity = `${pack.key}@${pack.version}`
      if (identities.has(identity)) {
        throw new Error(`DUPLICATE_PACK_IDENTITY: ${identity}`)
      }
      identities.add(identity)

      const selectorIdentity = `${pack.layer}:${pack.selector}@${pack.version}`
      if (selectors.has(selectorIdentity)) {
        throw new Error(`AMBIGUOUS_PACK_SELECTOR: ${selectorIdentity}`)
      }
      selectors.add(selectorIdentity)

      return {
        ...pack,
        contentHash: hashSiteForgeContent(pack),
      }
    })

    const registeredKeys = new Set(this.packs.map(pack => pack.key))
    for (const pack of this.packs) {
      const missingConflict = pack.conflictsWith.find(
        key => !registeredKeys.has(key)
      )
      if (missingConflict) {
        throw new Error(
          `UNKNOWN_PACK_CONFLICT: ${pack.key} references ${missingConflict}`
        )
      }
    }
  }

  list(): readonly RegisteredVerticalPack[] {
    return this.packs
  }

  get(layer: VerticalPackLayer, selector: string): RegisteredVerticalPack {
    const matches = this.packs.filter(
      pack => pack.layer === layer && pack.selector === selector
    )
    if (matches.length === 0) {
      throw new Error(`PACK_NOT_FOUND: ${layer}:${selector}@${this.version}`)
    }
    if (matches.length > 1) {
      throw new Error(`AMBIGUOUS_PACK_SELECTOR: ${layer}:${selector}`)
    }
    return matches[0]
  }

  resolveSelection(
    request: VerticalCompositionRequest
  ): RegisteredVerticalPack[] {
    if (request.registryVersion !== this.version) {
      throw new Error(
        `REGISTRY_VERSION_NOT_FOUND: requested ${request.registryVersion}, available ${this.version}`
      )
    }
    return [
      this.get('core', 'real_estate'),
      this.get('scope', request.scope),
      this.get('sector', request.sector),
      this.get('transaction', request.transaction),
      this.get('archetype', request.archetype),
      ...[...request.modifiers]
        .sort((a, b) => a.localeCompare(b))
        .map(modifier => this.get('modifier', modifier)),
      this.get('lifecycle', request.lifecycle),
    ]
  }
}

export const siteForgeVerticalRegistry = new VerticalPackRegistry(
  VERTICAL_REGISTRY_VERSION,
  SITEFORGE_VERTICAL_PACKS
)
