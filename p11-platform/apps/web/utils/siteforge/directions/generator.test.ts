import { describe, expect, it } from 'vitest'
import type { SiteForgeBrief } from '@/utils/siteforge/briefs/contracts'
import { normalizeBrandForgeContract } from '@/utils/brandforge/normalize'
import {
  assertMateriallyDistinctDirections,
  hashSiteForgeDirectionSet,
} from './contracts'
import { generateDeterministicCreativeDirections } from './generator'

const brief: SiteForgeBrief = {
  title: 'Juniper House',
  summary: 'A trusted property website.',
  objectives: [
    {
      statement: 'Increase qualified tours',
      priority: 'primary',
      successSignal: 'More completed tour requests',
    },
  ],
  audiences: [
    {
      segment: 'Urban renters',
      needs: ['Availability'],
      objections: ['Unclear value'],
    },
  ],
  conversion: {
    primaryAction: 'Schedule a tour',
    secondaryActions: [],
    funnelNotes: 'Lead with proof.',
  },
  scope: { includedPages: ['Home'], excludedItems: [] },
  stakeholders: [],
  approvers: [],
  launchTarget: {
    targetDate: null,
    timezone: 'America/Los_Angeles',
    flexibility: 'target',
  },
  legalConstraints: [],
  integrationConstraints: [],
  references: [],
  kpis: [],
}

const sources = {
  briefVersionId: '11111111-1111-4111-8111-111111111111',
  briefContentHash: 'a'.repeat(64),
  onboardingSnapshotId: '22222222-2222-4222-8222-222222222222',
  onboardingSnapshotHash: 'b'.repeat(64),
  // PostgreSQL accepts UUID-shaped identifiers without an RFC version nibble.
  brandAssetId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  brandContractHash: 'c'.repeat(64),
}

function brand(
  colors = ['#123456', '#ABCDEF', '#F4F1EA', '#111111']
) {
  return normalizeBrandForgeContract(
    {
      typography: {
        roles: [
          { role: 'headline', family: 'Fraunces', weights: [600], usage: 'Headings' },
          { role: 'body', family: 'Source Sans 3', weights: [400], usage: 'Body' },
        ],
      },
      colors: {
        roles: colors.map((hex, index) => ({
          role: ['primary', 'secondary', 'background', 'text'][index],
          name: `Color ${index + 1}`,
          hex,
          usage: 'Approved brand use',
        })),
      },
    },
    { origin: 'generated', approvalStatus: 'approved' }
  )
}

describe('SiteForge deterministic creative directions', () => {
  it('generates three materially distinct structured options with provenance', () => {
    const directions = generateDeterministicCreativeDirections({
      brief,
      brand: brand(),
      sources,
    })
    expect(directions).toHaveLength(3)
    expect(new Set(directions.map(direction => direction.name)).size).toBe(3)
    expect(new Set(directions.map(direction => direction.contentHash)).size).toBe(3)
    expect(directions[0]?.direction.provenance).toEqual({
      generator: 'siteforge-deterministic-directions-v1',
      ...sources,
    })
    expect(() => assertMateriallyDistinctDirections(directions)).not.toThrow()
  })

  it('is deterministic and changes the set hash when a direction is selected', () => {
    const first = generateDeterministicCreativeDirections({
      brief,
      brand: brand(),
      sources,
    })
    const second = generateDeterministicCreativeDirections({
      brief,
      brand: brand(),
      sources,
    })
    expect(second).toEqual(first)
    const unselected = hashSiteForgeDirectionSet({
      briefVersionId: sources.briefVersionId,
      briefContentHash: sources.briefContentHash,
      directionHashes: first.map(direction => direction.contentHash),
      selectedDirectionHash: null,
      selectionNotes: null,
    })
    const selected = hashSiteForgeDirectionSet({
      briefVersionId: sources.briefVersionId,
      briefContentHash: sources.briefContentHash,
      directionHashes: first.map(direction => direction.contentHash),
      selectedDirectionHash: first[1]!.contentHash,
      selectionNotes: 'Best conversion balance',
    })
    expect(selected).not.toBe(unselected)
    expect(selected).toMatch(/^[a-f0-9]{64}$/)
  })
})
