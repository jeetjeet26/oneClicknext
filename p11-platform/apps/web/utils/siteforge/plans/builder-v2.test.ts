import { describe, expect, it } from 'vitest'
import { SITEFORGE_VERTICAL_MATRIX_V1 } from '@/fixtures/siteforge-vertical-matrix.v1'
import {
  hashBrandForgeContract,
  normalizeBrandForgeContract,
} from '@/utils/brandforge/normalize'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { composeVerticalPacks } from '@/utils/siteforge/verticals/composition'
import { synthesizeSiteStory } from '@/utils/siteforge/guided/adaptive-discovery'
import {
  hashSiteForgeDirection,
  type SiteForgeDirectionCandidate,
} from '@/utils/siteforge/directions/contracts'
import {
  buildSiteForgePlanV2,
  hashSiteForgePlanV2CausalInputs,
} from './builder-v2'

function verticalContext(overrides?: {
  observedAt?: string | null
  freshUntil?: string | null
}) {
  const fixture = SITEFORGE_VERTICAL_MATRIX_V1[0]
  const manifest = composeVerticalPacks(fixture.request)
  const entries = manifest.requiredEvidence.map(requirement => ({
    id: `test:${requirement.id}`,
    kind: requirement.kind,
    label: requirement.kind,
    sourceType: 'test',
    sourceId: requirement.id,
    url: null,
    observedAt:
      overrides?.observedAt === undefined
        ? '2026-08-17T12:00:00.000Z'
        : overrides.observedAt,
    freshUntil: overrides?.freshUntil ?? null,
  }))
  return {
    profile: {
      id: 'profile-1',
      version: 1,
      contentHash: 'a'.repeat(64),
      mappingStatus: 'confirmed' as const,
      mappingReason: null,
      value: {
        schemaVersion: 2 as const,
        subjectKind: 'real_estate_property' as const,
        verticalKey: 'multifamily' as const,
        displayName: 'Multifamily',
        operatingModel: 'rental' as const,
        attributes: {},
        audiences: ['Prospective residents'],
        complianceTags: [],
        source: 'operator' as const,
      },
    },
    manifest,
    evidence: {
      contextHash: hashSiteForgeContent(entries),
      entries,
    },
  }
}

function story(context = verticalContext()) {
  return synthesizeSiteStory(context)
}

function direction(id = 'direction-1'): SiteForgeDirectionCandidate & { id: string } {
  const candidate = {
    id,
    ordinal: 1,
    name: 'Editorial clarity',
    direction: {
      rationale: 'Use grounded editorial clarity.',
      typography: {
        headingFamily: 'Inter',
        bodyFamily: 'Inter',
        scale: 'Balanced',
        weightStrategy: 'Medium',
      },
      palette: {
        primary: '#112233',
        secondary: '#334455',
        accent: '#556677',
        background: '#ffffff',
        text: '#111111',
      },
      hero: {
        composition: 'Editorial',
        headlineStyle: 'Direct',
        mediaTreatment: 'Natural',
      },
      layout: { system: 'Grid', density: 'Balanced', sectionRhythm: 'Measured' },
      imagery: {
        style: 'Documentary',
        subjects: ['Architecture'],
        treatment: 'Natural light',
      },
      cta: { label: 'Learn more', placement: 'Hero', style: 'Solid' },
      voice: {
        traits: ['clear', 'warm'],
        do: ['Use verified facts'],
        dont: ['Use hype'],
      },
      tradeoffs: ['Prioritizes clarity over novelty'],
      provenance: {
        generator: 'siteforge-deterministic-directions-v1' as const,
        briefVersionId: '11111111-1111-4111-8111-111111111111',
        briefContentHash: 'b'.repeat(64),
        onboardingSnapshotId: '22222222-2222-4222-8222-222222222222',
        onboardingSnapshotHash: 'c'.repeat(64),
        brandAssetId: '33333333-3333-4333-8333-333333333333',
        brandContractHash: 'd'.repeat(64),
      },
    },
    previewManifest: {
      paletteSwatches: ['#112233', '#334455', '#556677', '#ffffff', '#111111'],
      heroMode: 'Editorial',
      layoutMode: 'Grid',
      typographyPairing: 'Inter / Inter',
    },
  }
  return {
    ...candidate,
    contentHash: hashSiteForgeDirection({
      ordinal: candidate.ordinal,
      name: candidate.name,
      direction: candidate.direction,
      previewManifest: candidate.previewManifest,
    }),
  }
}

describe('SiteForge V2 causal story binding', () => {
  const discovery = {
    decisionSetHash: '1'.repeat(64),
    answerHash: '2'.repeat(64),
    discoveryHash: '3'.repeat(64),
  }

  it('changes the bound hash for story and selected-direction counterfactuals', () => {
    const baseStory = story()
    const base = hashSiteForgePlanV2CausalInputs({
      discovery,
      siteStory: { contract: baseStory.story, identity: baseStory.identity },
      selectedCreativeDirection: direction(),
    })
    const changedStory = {
      ...baseStory.story,
      promise: `${baseStory.story.promise} With a stronger proof-led opening.`,
    }
    const storyCounterfactual = hashSiteForgePlanV2CausalInputs({
      discovery,
      siteStory: {
        contract: changedStory,
        identity: {
          ...baseStory.identity,
          contentHash: hashSiteForgeContent(changedStory),
        },
      },
      selectedCreativeDirection: direction(),
    })
    const directionCounterfactual = hashSiteForgePlanV2CausalInputs({
      discovery,
      siteStory: { contract: baseStory.story, identity: baseStory.identity },
      selectedCreativeDirection: direction('direction-2'),
    })

    expect(storyCounterfactual).not.toBe(base)
    expect(directionCounterfactual).not.toBe(base)
  })

  it('normalizes Postgres offset timestamps into the canonical plan contract', () => {
    const context = verticalContext({
      observedAt: '2026-08-17T12:00:00+00:00',
      freshUntil: '2026-08-20T12:00:00+00:00',
    })
    const value = story(context)
    const brandContract = normalizeBrandForgeContract(
      {
        identity: { name: 'Evidence Apartments' },
        colors: {
          roles: [
            { role: 'primary', name: 'Ink', hex: '#112233', usage: 'Primary' },
          ],
        },
      },
      { origin: 'imported', approvalStatus: 'approved' }
    )
    const plan = buildSiteForgePlanV2({
      propertyId: '22222222-2222-4222-8222-222222222222',
      propertyName: 'Evidence Apartments',
      brandContext: {
        source: 'brandforge',
        confidence: 1,
        brandPersonality: { primary: 'Warm', traits: ['clear'], avoid: [] },
        visualIdentity: {
          moodKeywords: ['warm'],
          colorMood: 'Warm',
          photoStyle: {
            lighting: 'Natural',
            composition: 'Editorial',
            subjects: 'Architecture',
            mood: 'Calm',
          },
          designStyle: 'Editorial',
        },
        targetAudience: {
          demographics: 'Prospective residents',
          psychographics: 'Value clarity',
          priorities: [],
          painPoints: [],
        },
        positioning: {
          category: 'Multifamily',
          differentiators: ['Verified inventory'],
          competitiveAdvantage: 'Verified facts',
          messagingPillars: [],
        },
        contentStrategy: {
          voiceTone: 'Warm',
          vocabularyUse: [],
          vocabularyAvoid: [],
          headlineStyle: 'Direct',
          storytellingFocus: 'Proof',
        },
        designPrinciples: [],
      },
      brandAssetId: '77777777-7777-4777-8777-777777777777',
      brandContract,
      brandContractHash: hashBrandForgeContract(brandContract),
      onboardingSnapshot: {
        id: '66666666-6666-4666-8666-666666666666',
        contentHash: 'c'.repeat(64),
        enabledCapabilities: [],
      },
      verticalContext: context,
      discovery,
      siteStory: { contract: value.story, identity: value.identity },
      selectedCreativeDirection: direction(),
      capturedAt: '2026-08-17T13:00:00.000Z',
    })

    for (const entry of plan.evidence) {
      expect(entry.capturedAt).toBe('2026-08-17T12:00:00.000Z')
      expect(entry.sourceUpdatedAt).toBe('2026-08-17T12:00:00.000Z')
    }
    for (const snapshot of plan.offeringCatalog.snapshots) {
      expect(snapshot.freshUntil).toBe('2026-08-20T12:00:00.000Z')
    }
  })

  it('rejects stale story identities', () => {
    const value = story()
    expect(() =>
      hashSiteForgePlanV2CausalInputs({
        discovery,
        siteStory: {
          contract: { ...value.story, promise: 'Changed without re-hashing.' },
          identity: value.identity,
        },
        selectedCreativeDirection: direction(),
      })
    ).toThrow('PLAN_V2_SITE_STORY_IDENTITY_MISMATCH')
  })
})
