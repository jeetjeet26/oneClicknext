import type { BrandContext } from '@/utils/siteforge/agents/brand-agent'
import {
  generationPreferencesSchema,
  siteForgePlanSchema,
  siteForgeSiteTypeSchema,
  type SiteForgePlan,
} from '@/utils/siteforge/contracts'
import type { BrandForgeContractV1 } from '@/utils/brandforge/contracts'

type BuildSiteForgePlanInput = {
  propertyId: string
  propertyName: string
  brandContext: BrandContext
  brandAssetId: string
  brandContract: BrandForgeContractV1
  brandContractHash: string
  onboardingSnapshot: {
    id: string
    contentHash: string
    enabledCapabilities: Array<'crm' | 'tours' | 'chatbot' | 'analytics'>
    sourceReferences: Array<{ domain?: string; sourceId?: string }>
  }
  preferences?: unknown
  siteType?: unknown
  operatorDirection?: string | null
  capturedAt?: string
}

type SiteForgeSiteType = ReturnType<typeof siteForgeSiteTypeSchema.parse>

function applySiteTypeTemplate(
  standardPages: SiteForgePlan['pages'],
  siteType: SiteForgeSiteType,
  sourceId: string
): SiteForgePlan['pages'] {
  if (siteType === 'standard') return standardPages

  if (siteType === 'lease-up') {
    return standardPages.map(page => ({
      ...page,
      sections: page.sections.map(section =>
        section.block === 'acf/top-slides'
          ? { ...section, variant: 'immersive' }
          : section.block === 'acf/plans-availability'
            ? {
                ...section,
                variant: 'preleasing',
                purpose:
                  'Present verified pre-leasing inventory and registration paths.',
              }
            : section
      ),
    }))
  }

  if (siteType === 'student') {
    const contactIndex = standardPages.findIndex(page => page.slug === 'contact')
    const studentLife = {
      slug: 'student-life',
      title: 'Student Life',
      navLabel: 'Student Life',
      purpose:
        'Present verified study, social, transportation, and resident-support features without demographic targeting.',
      sections: [
        {
          id: 'student-life-highlights',
          label: 'Student living highlights',
          purpose:
            'Organize verified property features relevant to day-to-day student living.',
          block: 'acf/content-grid' as const,
          variant: 'bento',
          required: true,
          factsRequired: ['verified property amenities and services'],
          evidenceIds: [sourceId],
        },
        {
          id: 'student-life-faq',
          label: 'Resident questions',
          purpose:
            'Answer verified questions about leasing, services, and community policies.',
          block: 'acf/accordion-section' as const,
          variant: 'bordered',
          required: false,
          factsRequired: ['verified leasing and property policies'],
          evidenceIds: [sourceId],
        },
      ],
    }
    return [
      ...standardPages.slice(0, Math.max(contactIndex, 0)),
      studentLife,
      ...standardPages.slice(Math.max(contactIndex, 0)),
    ]
  }

  if (siteType === 'senior') {
    const contactIndex = standardPages.findIndex(page => page.slug === 'contact')
    const services = {
      slug: 'services',
      title: 'Services',
      navLabel: 'Services',
      purpose:
        'Explain verified residence services, accessibility features, and support offerings.',
      sections: [
        {
          id: 'services-overview',
          label: 'Services overview',
          purpose:
            'Present verified services and accessibility features with clear, factual language.',
          block: 'acf/feature-section' as const,
          variant: 'spotlight',
          required: true,
          factsRequired: ['verified services and accessibility features'],
          evidenceIds: [sourceId],
        },
        {
          id: 'services-faq',
          label: 'Services questions',
          purpose: 'Answer verified questions about services and residence policies.',
          block: 'acf/accordion-section' as const,
          variant: 'minimal',
          required: false,
          factsRequired: ['verified services and residence policies'],
          evidenceIds: [sourceId],
        },
      ],
    }
    return [
      ...standardPages.slice(0, Math.max(contactIndex, 0)),
      services,
      ...standardPages.slice(Math.max(contactIndex, 0)),
    ]
  }

  const home = standardPages.find(page => page.slug === 'home')
  const amenities = standardPages.find(page => page.slug === 'amenities')
  const neighborhood = standardPages.find(page => page.slug === 'neighborhood')
  const contact = standardPages.find(page => page.slug === 'contact')
  return [
    {
      slug: 'home',
      title: 'Property Overview',
      navLabel: 'Overview',
      purpose:
        'Provide a focused property landing experience with brand, highlights, location, and conversion in one page.',
      sections: [
        ...(home?.sections || []).map(section =>
          section.block === 'acf/top-slides'
            ? { ...section, variant: 'panoramic' }
            : section
        ),
        ...(amenities?.sections || []),
        ...(neighborhood?.sections || []).slice(0, 1),
        ...(contact?.sections || []),
      ],
    },
  ]
}

function primaryActionLabel(
  action: 'tours' | 'applications' | 'contact' | 'calls'
): string {
  switch (action) {
    case 'applications':
      return 'Apply now'
    case 'contact':
      return 'Contact the leasing team'
    case 'calls':
      return 'Call the property'
    default:
      return 'Schedule a tour'
  }
}

export function buildSiteForgePlan(input: BuildSiteForgePlanInput): SiteForgePlan {
  const capturedAt = input.capturedAt || new Date().toISOString()
  const preferences = generationPreferencesSchema.parse(input.preferences || {})
  const primaryAction = preferences.ctaPriority || 'contact'
  const enabledCapabilities = Array.from(new Set([
    ...preferences.enabledCapabilities,
    ...(primaryAction === 'tours' ? ['tours' as const] : []),
  ]))
  const operatorDirection = input.operatorDirection?.trim()
  const siteType = siteForgeSiteTypeSchema.parse(input.siteType || 'standard')
  const sourceId = input.brandAssetId
  const differentiators = input.brandContext.positioning.differentiators.slice(0, 4)
  const priorities = input.brandContext.targetAudience.priorities.slice(0, 4)

  return siteForgePlanSchema.parse({
    schemaVersion: 1,
    siteType,
    propertyId: input.propertyId,
    onboardingSnapshot: {
      id: input.onboardingSnapshot.id,
      contentHash: input.onboardingSnapshot.contentHash,
      enabledCapabilities: input.onboardingSnapshot.enabledCapabilities,
    },
    brandSnapshot: {
      assetId: input.brandAssetId,
      contractVersion: input.brandContract.contractVersion,
      contractHash: input.brandContractHash,
      origin: input.brandContract.origin,
      contract: input.brandContract,
    },
    enabledCapabilities,
    name: `${input.propertyName} ${siteType} website plan`,
    summary: `A grounded, conversion-focused ${siteType} multifamily website for ${input.propertyName}, centered on ${preferences.emphasis || 'the strongest verified property story'}.`,
    preferences,
    brandDirection: {
      positioning:
        input.brandContext.positioning.competitiveAdvantage ||
        differentiators.join(', ') ||
        `${input.propertyName} should be presented using verified property strengths.`,
      voice: input.brandContext.contentStrategy.voiceTone,
      visualDirection:
        input.brandContext.visualIdentity.designStyle ||
        input.brandContext.visualIdentity.moodKeywords.join(', ') ||
        `Apply the approved ${input.propertyName} brand system consistently.`,
      mustInclude: [
        ...differentiators,
        ...(operatorDirection ? [`Operator direction: ${operatorDirection}`] : []),
      ],
      mustAvoid: [
        ...input.brandContext.brandPersonality.avoid,
        ...input.brandContext.contentStrategy.vocabularyAvoid,
      ],
    },
    audiences: priorities.length
      ? [
          {
            label: 'Prospective residents',
            contentNeeds: priorities,
          },
        ]
      : [],
    pages: applySiteTypeTemplate([
      {
        slug: 'home',
        title: 'Home',
        navLabel: 'Home',
        purpose: 'Establish the property promise and move prospects toward the primary action.',
        sections: [
          {
            id: 'home-hero',
            label: 'Property introduction',
            purpose: 'Express the approved positioning with a clear conversion action.',
            block: 'acf/top-slides',
            variant: 'editorial',
            required: true,
            factsRequired: ['property name', 'approved positioning'],
            evidenceIds: [sourceId],
          },
          {
            id: 'home-story',
            label: 'Property story',
            purpose: 'Explain the verified lifestyle and differentiators.',
            block: 'acf/text-section',
            variant: 'editorial',
            required: true,
            factsRequired: differentiators,
            evidenceIds: [sourceId],
          },
          {
            id: 'home-highlights',
            label: 'Community highlights',
            purpose: 'Summarize verified amenities and property strengths.',
            block: 'acf/content-grid',
            variant: 'amenity-grid',
            required: true,
            factsRequired: differentiators,
            evidenceIds: [sourceId],
          },
          {
            id: 'home-testimonials',
            label: 'Resident experiences',
            purpose:
              'Show only approved, source-managed ReviewFlow reviews when they are available.',
            block: 'acf/testimonials',
            variant: 'cards',
            required: false,
            factsRequired: ['approved ReviewFlow reviews'],
            evidenceIds: [sourceId],
          },
          {
            id: 'home-conversion',
            label: primaryActionLabel(primaryAction),
            purpose: 'Provide the approved primary conversion path.',
            block: 'acf/form',
            variant: 'card',
            required: true,
            factsRequired: [],
            evidenceIds: [sourceId],
          },
        ],
      },
      {
        slug: 'floor-plans',
        title: 'Floor Plans',
        navLabel: 'Floor Plans',
        purpose: 'Help prospects browse normalized inventory and take the next step.',
        sections: [
          {
            id: 'floor-plans-browser',
            label: 'Floor-plan browser',
            purpose: 'Render canonical unit-type, pricing, and availability data.',
            block: 'acf/plans-availability',
            variant: 'cards',
            required: true,
            factsRequired: ['property unit inventory'],
            evidenceIds: [sourceId],
          },
        ],
      },
      {
        slug: 'amenities',
        title: 'Amenities',
        navLabel: 'Amenities',
        purpose: 'Present verified community and residence amenities.',
        sections: [
          {
            id: 'amenities-grid',
            label: 'Amenity collection',
            purpose: 'Organize verified amenities into an easy-to-scan collection.',
            block: 'acf/content-grid',
            variant: 'editorial',
            required: true,
            factsRequired: ['verified amenities'],
            evidenceIds: [sourceId],
          },
          {
            id: 'amenities-gallery',
            label: 'Amenity gallery',
            purpose: 'Support the amenity story with approved imagery.',
            block: 'acf/gallery',
            variant: 'masonry',
            required: false,
            factsRequired: [],
            evidenceIds: [sourceId],
          },
        ],
      },
      {
        slug: 'neighborhood',
        title: 'Neighborhood',
        navLabel: 'Neighborhood',
        purpose: 'Explain the verified location context without demographic or safety claims.',
        sections: [
          {
            id: 'neighborhood-story',
            label: 'Location story',
            purpose: 'Describe verified destinations and connectivity.',
            block: 'acf/poi',
            variant: 'editorial',
            required: true,
            factsRequired: ['verified nearby destinations'],
            evidenceIds: [sourceId],
          },
          {
            id: 'neighborhood-map',
            label: 'Map',
            purpose: 'Provide location and directions.',
            block: 'acf/map',
            required: true,
            factsRequired: ['property address'],
            evidenceIds: [sourceId],
          },
        ],
      },
      {
        slug: 'contact',
        title: 'Contact',
        navLabel: 'Contact',
        purpose: 'Provide accessible leasing contact and registration paths.',
        sections: [
          {
            id: 'contact-form',
            label: 'Contact the leasing team',
            purpose: 'Capture an attributed, consent-aware lead.',
            block: 'acf/form',
            variant: 'card',
            required: true,
            factsRequired: ['property contact details'],
            evidenceIds: [sourceId],
          },
        ],
      },
    ], siteType, sourceId),
    conversionStrategy: {
      primaryAction,
      secondaryAction: primaryAction === 'contact' ? 'tours' : 'contact',
      // Lead capture always posts to the platform conversion endpoint (the
      // WordPress form block supports no other provider). The CRM capability
      // only controls downstream syncing of captured leads.
      leadDestination: 'p11_lumaleasing',
      tourDestination: enabledCapabilities.includes('tours')
        ? 'p11_lumaleasing'
        : 'unconfigured',
      requiredForms: primaryAction === 'tours' ? ['tour', 'contact'] : ['contact'],
    },
    floorPlanStrategy: {
      source: 'property_units',
      display: 'cards',
      showPricing: true,
      // Availability is optional unless an operator explicitly enables it in a
      // later revision; manual inventory often describes layouts, not live stock.
      showAvailability: false,
      freshnessHours: 168,
    },
    seoStrategy: {
      localSearchFocus: [`${input.propertyName} apartments`],
      structuredData: ['Organization', 'ApartmentComplex', 'BreadcrumbList'],
    },
    analyticsStrategy: {
      enabled: enabledCapabilities.includes('analytics'),
      consentMode: enabledCapabilities.includes('analytics') ? 'required' : 'unconfigured',
      events: enabledCapabilities.includes('analytics') ? [
        'page_view',
        'cta_click',
        'floorplan_view',
        'availability_click',
        'lead_start',
        'lead_submit',
        'tour_start',
        'tour_booked',
      ] : [],
    },
    accessibilityRequirements: [
      'WCAG 2.2 AA automated checks',
      'Keyboard-operable navigation and controls',
      'Visible focus indicators',
      'Reduced-motion support',
      'Contextual alternative text',
    ],
    legalRequirements: [
      'Equal Housing Opportunity disclosure',
      'Accessibility statement',
      'Privacy policy',
      'Consent language for email and SMS capture',
      'Pricing and availability disclaimer',
    ],
    knownFacts: [
      {
        claim: `The approved brand context source is ${input.brandContext.source}.`,
        evidenceIds: [sourceId],
      },
      ...differentiators.map((claim) => ({ claim, evidenceIds: [sourceId] })),
    ],
    recommendations: operatorDirection ? [operatorDirection] : [],
    unresolvedQuestions: [],
    evidence: [
      {
        id: sourceId,
        sourceType: 'brandforge',
        sourceId: input.brandAssetId,
        label: `${input.propertyName} approved BrandForge contract`,
        capturedAt,
        confidence: input.brandContext.confidence,
        retrievalStatus: 'available',
      },
      ...input.onboardingSnapshot.sourceReferences.flatMap(reference =>
        reference.sourceId
          ? [{
              id: reference.sourceId,
              sourceType: 'document' as const,
              sourceId: reference.sourceId,
              label: `${reference.domain || 'onboarding'} approved source`,
              capturedAt,
              confidence: 1,
              retrievalStatus: 'available' as const,
            }]
          : [],
      ),
    ],
  })
}
