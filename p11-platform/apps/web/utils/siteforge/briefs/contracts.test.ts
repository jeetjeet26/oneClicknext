import { describe, expect, it } from 'vitest'
import {
  assertSiteForgeBriefApprovable,
  hashSiteForgeBrief,
  siteForgeBriefSchema,
  type SiteForgeBrief,
  type SiteForgeBriefSourceIdentity,
} from './contracts'

const sources: SiteForgeBriefSourceIdentity = {
  onboardingSnapshotId: '11111111-1111-4111-8111-111111111111',
  onboardingSnapshotHash: 'a'.repeat(64),
  brandAssetId: '22222222-2222-4222-8222-222222222222',
  brandContractHash: 'b'.repeat(64),
}

const brief: SiteForgeBrief = {
  title: 'Juniper House website brief',
  summary: 'Create a conversion-oriented property website.',
  objectives: [
    {
      statement: 'Increase qualified tours',
      priority: 'primary',
      successSignal: 'Tour conversion improves',
    },
  ],
  audiences: [
    {
      segment: 'Urban renters',
      needs: ['Clear availability'],
      objections: ['Unclear value'],
    },
  ],
  conversion: {
    primaryAction: 'Schedule a tour',
    secondaryActions: ['View availability'],
    funnelNotes: 'Show proof before requesting contact details.',
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
  kpis: [
    {
      name: 'Tour requests',
      target: '+15%',
      measurement: 'Submitted tour forms',
    },
  ],
}

describe('SiteForge durable brief contract', () => {
  it('requires structured objectives, audiences, conversion, scope, and KPIs', () => {
    expect(siteForgeBriefSchema.parse(brief)).toEqual(brief)
    expect(() =>
      siteForgeBriefSchema.parse({ ...brief, objectives: [] })
    ).toThrow()
  })

  it('hashes canonical content and pinned source identities deterministically', () => {
    const first = hashSiteForgeBrief({
      brief,
      unresolvedContradictions: [],
      sources,
    })
    const reordered = hashSiteForgeBrief({
      brief: { ...brief, summary: brief.summary },
      unresolvedContradictions: [],
      sources: { ...sources },
    })
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(reordered).toBe(first)
    expect(
      hashSiteForgeBrief({
        brief,
        unresolvedContradictions: [],
        sources: { ...sources, onboardingSnapshotHash: 'c'.repeat(64) },
      })
    ).not.toBe(first)
  })

  it('blocks approval for contradictions, stale sources, or stale content', () => {
    expect(() =>
      assertSiteForgeBriefApprovable({
        status: 'ready_for_review',
        unresolvedContradictions: [],
        expectedContentHash: 'c'.repeat(64),
        actualContentHash: 'c'.repeat(64),
        pinnedSources: sources,
        currentSources: sources,
      })
    ).not.toThrow()
    expect(() =>
      assertSiteForgeBriefApprovable({
        status: 'ready_for_review',
        unresolvedContradictions: [
          {
            id: 'pricing',
            field: 'pricing',
            description: 'Two source prices differ',
            sources: ['source-a', 'source-b'],
            resolutionNeeded: 'Confirm current pricing',
          },
        ],
        expectedContentHash: 'c'.repeat(64),
        actualContentHash: 'c'.repeat(64),
        pinnedSources: sources,
        currentSources: sources,
      })
    ).toThrow('Resolve all brief contradictions')
    expect(() =>
      assertSiteForgeBriefApprovable({
        status: 'ready_for_review',
        unresolvedContradictions: [],
        expectedContentHash: 'c'.repeat(64),
        actualContentHash: 'c'.repeat(64),
        pinnedSources: sources,
        currentSources: { ...sources, brandContractHash: 'd'.repeat(64) },
      })
    ).toThrow('sources are stale')
  })
})
