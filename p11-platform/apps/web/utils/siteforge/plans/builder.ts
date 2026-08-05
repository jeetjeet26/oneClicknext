import type { BrandContext } from '@/utils/siteforge/agents/brand-agent'
import {
  generationPreferencesSchema,
  siteForgePlanSchema,
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
  operatorDirection?: string | null
  capturedAt?: string
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
  const sourceId = input.brandAssetId
  const differentiators = input.brandContext.positioning.differentiators.slice(0, 4)
  const priorities = input.brandContext.targetAudience.priorities.slice(0, 4)

  return siteForgePlanSchema.parse({
    schemaVersion: 1,
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
    name: `${input.propertyName} website plan`,
    summary: `A grounded, conversion-focused multifamily website for ${input.propertyName}, centered on ${preferences.emphasis || 'the strongest verified property story'}.`,
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
    pages: [
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
    ],
    conversionStrategy: {
      primaryAction,
      secondaryAction: primaryAction === 'contact' ? 'tours' : 'contact',
      leadDestination: enabledCapabilities.includes('crm')
        ? 'p11_lumaleasing'
        : 'csv_export',
      tourDestination: enabledCapabilities.includes('tours')
        ? 'p11_lumaleasing'
        : 'unconfigured',
      requiredForms: primaryAction === 'tours' ? ['tour', 'contact'] : ['contact'],
    },
    floorPlanStrategy: {
      source: 'property_units',
      display: 'cards',
      showPricing: true,
      showAvailability: true,
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
