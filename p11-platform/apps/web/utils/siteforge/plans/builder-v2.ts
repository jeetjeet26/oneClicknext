import type { BrandContext } from '@/utils/siteforge/agents/brand-agent'
import type { BrandForgeContractV1 } from '@/utils/brandforge/contracts'
import {
  generationPreferencesSchema,
  siteForgePlanV2Schema,
  type SiteForgePlanV2,
} from '@/utils/siteforge/contracts'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import type { AdaptiveVerticalContext } from '@/utils/siteforge/guided/adaptive-discovery'
import {
  siteStoryContractSchema,
  siteStoryIdentitySchema,
  type SiteStoryContract,
  type SiteStoryIdentity,
} from '@/utils/siteforge/guided/contracts'
import {
  hashSiteForgeDirection,
  type SiteForgeDirectionCandidate,
} from '@/utils/siteforge/directions/contracts'
import type {
  VerticalOfferingKind,
  VerticalPackIdentity,
} from '@/utils/siteforge/verticals/contracts'
import { evaluateVerticalPolicies } from '@/utils/siteforge/policies/vertical-policy-packs'

export type BuildSiteForgePlanV2Input = {
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
  }
  verticalContext: AdaptiveVerticalContext
  discovery: {
    decisionSetHash: string
    answerHash: string
    discoveryHash: string
  }
  siteStory: {
    contract: SiteStoryContract
    identity: SiteStoryIdentity
  }
  selectedCreativeDirection: SiteForgeDirectionCandidate & { id: string }
  preferences?: unknown
  operatorDirection?: string | null
  capturedAt?: string
}

function packOwner(
  declarationId: string,
  packs: readonly VerticalPackIdentity[]
): VerticalPackIdentity {
  const owner = packs.find(pack =>
    declarationId.startsWith(`${pack.layer}.${pack.selector}.`)
  )
  if (!owner) {
    throw new Error(`Pack-owned declaration ${declarationId} has no exact owner`)
  }
  return owner
}

function pageSlug(slug: string): string {
  return slug === '/' ? 'home' : slug.replace(/^\/+|\/+$/g, '')
}

function displayForOffering(
  kind: VerticalOfferingKind
): SiteForgePlanV2['offeringStrategies'][number]['display'] {
  if (kind === 'event' || kind === 'venue') return 'events_directory'
  if (kind === 'portfolio_property') return 'entity_directory'
  if (kind === 'care_residence') return 'comparison'
  return 'offering_browser'
}

export function hashSiteForgePlanV2CausalInputs(input: Pick<
  BuildSiteForgePlanV2Input,
  'discovery' | 'siteStory' | 'selectedCreativeDirection'
>): string {
  const story = siteStoryContractSchema.parse(input.siteStory.contract)
  const storyIdentity = siteStoryIdentitySchema.parse(input.siteStory.identity)
  const storyContentHash = hashSiteForgeContent(story)
  if (
    storyIdentity.id !== story.id
    || storyIdentity.contractVersion !== story.contractVersion
    || storyIdentity.contentHash !== storyContentHash
  ) {
    throw new Error('PLAN_V2_SITE_STORY_IDENTITY_MISMATCH')
  }
  const selectedDirectionHash = hashSiteForgeDirection({
    name: input.selectedCreativeDirection.name,
    ordinal: input.selectedCreativeDirection.ordinal,
    direction: input.selectedCreativeDirection.direction,
    previewManifest: input.selectedCreativeDirection.previewManifest,
  })
  if (selectedDirectionHash !== input.selectedCreativeDirection.contentHash) {
    throw new Error('PLAN_V2_CREATIVE_DIRECTION_IDENTITY_MISMATCH')
  }
  return hashSiteForgeContent({
    discovery: input.discovery,
    siteStory: storyIdentity,
    selectedCreativeDirection: {
      id: input.selectedCreativeDirection.id,
      contentHash: selectedDirectionHash,
    },
  })
}

export function buildSiteForgePlanV2(
  input: BuildSiteForgePlanV2Input
): SiteForgePlanV2 {
  const capturedAt = input.capturedAt || new Date().toISOString()
  const preferences = generationPreferencesSchema.parse(input.preferences || {})
  const { manifest, profile, evidence } = input.verticalContext
  const story = siteStoryContractSchema.parse(input.siteStory.contract)
  const storyIdentity = siteStoryIdentitySchema.parse(input.siteStory.identity)
  const causalDiscoveryHash = hashSiteForgePlanV2CausalInputs(input)
  if (profile.mappingStatus !== 'confirmed') {
    throw new Error('PLAN_V2_PROFILE_UNCONFIRMED')
  }

  const hierarchyEntries = evidence.entries.filter(
    entry => entry.sourceType === 'subject_relationship'
  )
  const offeringEntries = evidence.entries.filter(
    entry => entry.kind === 'offering_catalog'
  )
  const availabilityEntries = evidence.entries.filter(
    entry => entry.kind === 'availability'
  )
  const policyEntries = evidence.entries.filter(
    entry => entry.sourceType === 'approved_policy'
  )
  const policyEvaluation = evaluateVerticalPolicies({
    manifest,
    evidence: evidence.entries,
    now: new Date(capturedAt),
  })
  if (!policyEvaluation.ready) {
    const blockers = policyEvaluation.issues
      .filter(issue => issue.severity === 'blocker')
      .map(issue => `${issue.policyCode}:${issue.code}`)
    throw new Error(`PLAN_V2_POLICY_BLOCKED: ${blockers.join(', ')}`)
  }
  const hierarchyContentHash = hashSiteForgeContent(hierarchyEntries)
  const catalogContentHash = hashSiteForgeContent({
    offerings: offeringEntries,
    availability: availabilityEntries,
  })
  const policyContentHash = hashSiteForgeContent({
    requiredPolicyCodes: manifest.policyCodes,
    evidence: policyEntries,
  })

  const catalogSnapshots = manifest.offeringKinds.map(offeringKind => {
    const freshUntil = [...offeringEntries, ...availabilityEntries]
      .flatMap(entry => (entry.freshUntil ? [entry.freshUntil] : []))
      .sort()
      .at(0) || null
    const freshness = manifest.freshnessRules.find(rule =>
      ['offering_catalog', 'availability', 'pricing'].includes(
        rule.evidenceKind
      )
    )
    return {
      offeringKind,
      catalogContentHash: hashSiteForgeContent({
        offeringKind,
        entries: offeringEntries,
      }),
      availabilityContentHash: availabilityEntries.length
        ? hashSiteForgeContent({
            offeringKind,
            entries: availabilityEntries,
          })
        : null,
      evidenceIds: [...offeringEntries, ...availabilityEntries].map(
        entry => entry.id
      ),
      rowCount: offeringEntries.length,
      capturedAt,
      freshUntil,
      onStale: freshness?.onStale || ('require_confirmation' as const),
    }
  })
  const defaultCatalogHash =
    catalogSnapshots[0]?.catalogContentHash || hashSiteForgeContent([])
  const primaryOutcomes = manifest.analyticsOutcomes
    .filter(recipe => recipe.northStar)
    .map(recipe => recipe.outcome)
  const audiences = profile.value.audiences.length
    ? profile.value.audiences
    : ['Primary visitors']
  const differentiators =
    input.brandContext.positioning.differentiators.slice(0, 6)
  const operatorDirection = input.operatorDirection?.trim()

  return siteForgePlanV2Schema.parse({
    schemaVersion: 2,
    propertyId: input.propertyId,
    onboardingSnapshot: input.onboardingSnapshot,
    brandSnapshot: {
      assetId: input.brandAssetId,
      contractVersion: input.brandContract.contractVersion,
      contractHash: input.brandContractHash,
      origin: input.brandContract.origin,
      contract: input.brandContract,
    },
    verticalProfile: {
      id: profile.id,
      version: profile.version,
      contentHash: profile.contentHash,
    },
    verticalPackManifest: {
      registryVersion: manifest.registryVersion,
      contentHash: manifest.contentHash,
      packs: manifest.packs.map(pack => ({
        key: pack.key,
        version: pack.version,
        contentHash: pack.contentHash,
      })),
    },
    subjectHierarchy: {
      contentHash: hierarchyContentHash,
      evidenceIds: hierarchyEntries.map(entry => entry.id),
    },
    offeringCatalog: {
      contentHash: catalogContentHash,
      snapshots: catalogSnapshots,
    },
    policySet: {
      contentHash: policyContentHash,
      requiredPolicyCodes: manifest.policyCodes,
      evidenceIds: policyEntries.map(entry => entry.id),
    },
    discovery: {
      ...input.discovery,
      discoveryHash: causalDiscoveryHash,
      evidenceContextHash: evidence.contextHash,
    },
    enabledCapabilities: input.onboardingSnapshot.enabledCapabilities,
    name: `${input.propertyName} vertical website plan`,
    summary: story.promise,
    preferences,
    brandDirection: {
      positioning:
        input.brandContext.positioning.competitiveAdvantage ||
        differentiators.join(', ') ||
        `${input.propertyName} should be presented using verified strengths.`,
      voice: input.brandContext.contentStrategy.voiceTone,
      visualDirection:
        `Selected creative direction: ${input.selectedCreativeDirection.name}. ${
          input.brandContext.visualIdentity.designStyle
          || input.brandContext.visualIdentity.moodKeywords.join(', ')
          || `Apply the approved ${input.propertyName} brand system.`
        }`,
      mustInclude: [
        ...story.narrativeArc,
        ...differentiators,
        ...(operatorDirection ? [`Operator direction: ${operatorDirection}`] : []),
      ],
      mustAvoid: [
        ...input.brandContext.brandPersonality.avoid,
        ...input.brandContext.contentStrategy.vocabularyAvoid,
        ...manifest.forbiddenClaims,
      ],
    },
    audiences: audiences.map((label, index) => ({
      id: `audience.${index + 1}`,
      label,
      needs: story.audience.practicalNeeds,
      desiredOutcomes: primaryOutcomes,
    })),
    pages: manifest.pages.map(page => {
      const owner = packOwner(page.id, manifest.packs)
      const ownerKey = owner.key
      return {
        slug: pageSlug(page.slug),
        title: page.title,
        navLabel: page.title,
        purpose: page.sections.map(section => section.purpose).join(' '),
        sourcePackKey: ownerKey,
        sections: page.sections.map(section => ({
          id: section.id,
          label: section.purpose,
          purpose: section.purpose,
          block: section.blockKey,
          required: section.required,
          factsRequired: [],
          evidenceIds: evidence.entries
            .filter(entry =>
              manifest.requiredEvidence.some(
                requirement => requirement.kind === entry.kind
              )
            )
            .map(entry => entry.id),
          sourcePackKey: ownerKey,
          conversionIntent: section.conversionIntent,
        })),
        seo: {
          title: page.title,
          description: page.sections.map(section => section.purpose).join(' '),
          canonicalPath: page.slug,
          noIndex: false,
          structuredData: manifest.seoSchemaTypes.map(type => ({
            '@context': 'https://schema.org',
            '@type': type,
          })),
        },
      }
    }),
    conversionIntents: manifest.conversionIntentRecipes.map(recipe => ({
      ...recipe,
      provider: 'unconfigured',
    })),
    offeringStrategies: manifest.offeringKinds.map(offeringKind => ({
      offeringKind,
      display: displayForOffering(offeringKind),
      catalogContentHash:
        catalogSnapshots.find(
          snapshot => snapshot.offeringKind === offeringKind
        )?.catalogContentHash || defaultCatalogHash,
      showPricing: manifest.policyCodes.includes('pricing_availability'),
      showAvailability: manifest.freshnessRules.some(rule =>
        ['availability', 'pricing'].includes(rule.evidenceKind)
      ),
      freshnessHours:
        manifest.freshnessRules.find(rule =>
          ['offering_catalog', 'availability', 'pricing'].includes(
            rule.evidenceKind
          )
        )?.maxAgeHours || 8_760,
    })),
    analyticsRecipe: {
      enabled: input.onboardingSnapshot.enabledCapabilities.includes('analytics'),
      consentMode: 'required',
      outcomes: manifest.analyticsOutcomes,
    },
    accessibilityRequirements: [
      'WCAG 2.2 AA automated checks',
      'Keyboard-operable navigation and controls',
      'Visible focus indicators',
      'Reduced-motion support',
      'Contextual alternative text',
      ...policyEvaluation.manualChecks,
    ],
    knownFacts: evidence.entries.map(entry => ({
      claim: entry.label,
      evidenceIds: [entry.id],
    })),
    recommendations: [
      `Site story ${storyIdentity.id}: ${story.premise}`,
      ...(operatorDirection ? [operatorDirection] : []),
    ],
    unresolvedQuestions: [],
    evidence: evidence.entries.map(entry => ({
      id: entry.id,
      sourceType: 'operator',
      sourceId: entry.sourceId,
      label: entry.label,
      capturedAt: entry.observedAt || capturedAt,
      sourceUpdatedAt: entry.observedAt || undefined,
      confidence: 1,
      retrievalStatus: 'available',
    })),
  })
}
