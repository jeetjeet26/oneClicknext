import { describe, expect, it } from 'vitest'
import { SITEFORGE_VERTICAL_MATRIX_V1 } from '@/fixtures/siteforge-vertical-matrix.v1'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { composeVerticalPacks } from '@/utils/siteforge/verticals/composition'
import { synthesizeSiteStory } from '@/utils/siteforge/guided/adaptive-discovery'
import {
  hashSiteForgeDirection,
  type SiteForgeDirectionCandidate,
} from '@/utils/siteforge/directions/contracts'
import { hashSiteForgePlanV2CausalInputs } from './builder-v2'

function story() {
  const fixture = SITEFORGE_VERTICAL_MATRIX_V1[0]
  const manifest = composeVerticalPacks(fixture.request)
  const entries = manifest.requiredEvidence.map(requirement => ({
    id: `test:${requirement.id}`,
    kind: requirement.kind,
    label: requirement.kind,
    sourceType: 'test',
    sourceId: requirement.id,
    url: null,
    observedAt: '2026-08-17T12:00:00.000Z',
    freshUntil: null,
  }))
  return synthesizeSiteStory({
    profile: {
      id: 'profile-1',
      version: 1,
      contentHash: 'a'.repeat(64),
      mappingStatus: 'confirmed',
      mappingReason: null,
      value: {
        schemaVersion: 2,
        subjectKind: 'real_estate_property',
        verticalKey: 'multifamily',
        displayName: 'Multifamily',
        operatingModel: 'rental',
        attributes: {},
        audiences: ['Prospective residents'],
        complianceTags: [],
        source: 'operator',
      },
    },
    manifest,
    evidence: {
      contextHash: hashSiteForgeContent(entries),
      entries,
    },
  })
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
