import { describe, expect, it } from 'vitest'
import type { SiteBlueprint } from '@/types/siteforge'
import type { SiteForgePlan } from '@/utils/siteforge/contracts'
import { assertFactualSemanticEditGrounding } from './factual-guard'

function blueprint(
  content: Record<string, unknown>,
  acfBlock = 'acf/text-section',
  evidenceIds: string[] = ['evidence-1']
) {
  return {
    pages: [
      {
        slug: 'home',
        title: 'Home',
        purpose: 'Test',
        sections: [
          {
            id: 'section-1',
            type: 'content',
            acfBlock,
            content,
            reasoning: 'Test',
            order: 0,
            evidenceIds,
          },
        ],
      },
    ],
  } as unknown as SiteBlueprint
}

const propertyId = '66666666-6666-4666-8666-666666666666'
const confirmedPlan = {
  propertyId,
  knownFacts: [
    {
      claim: 'Acacia includes rooftop decks and solar.',
      evidenceIds: ['evidence-1'],
    },
  ],
} as unknown as SiteForgePlan

describe('assertFactualSemanticEditGrounding', () => {
  it('retains exact pinned claims when factual copy changes', () => {
    expect(() =>
      assertFactualSemanticEditGrounding({
        originalBlueprint: blueprint({ content: 'Older copy.' }),
        updatedBlueprint: blueprint({
          content: 'Acacia includes rooftop decks and solar. Schedule a tour.',
        }),
        confirmedPlan,
      })
    ).not.toThrow()
  })

  it('rejects invented factual copy that merely reuses an evidence ID', () => {
    expect(() =>
      assertFactualSemanticEditGrounding({
        originalBlueprint: blueprint({ content: 'Older copy.' }),
        updatedBlueprint: blueprint({
          content: 'Every home includes a private pool.',
        }),
        confirmedPlan,
      })
    ).toThrow('does not retain an exact claim from its pinned evidence')
  })

  it('allows edits to copy grounded on the pinned brand contract namespace', () => {
    const brandEvidence = [`brand-context:${propertyId}:0`]
    expect(() =>
      assertFactualSemanticEditGrounding({
        originalBlueprint: blueprint(
          { content: 'Older copy.' },
          'acf/text-section',
          brandEvidence
        ),
        updatedBlueprint: blueprint(
          { content: 'Refreshed on-brand copy.' },
          'acf/text-section',
          brandEvidence
        ),
        confirmedPlan,
      })
    ).not.toThrow()
  })

  it('rejects brand-context evidence pinned to another property', () => {
    const foreignEvidence = [
      'brand-context:99999999-9999-4999-8999-999999999999:0',
    ]
    expect(() =>
      assertFactualSemanticEditGrounding({
        originalBlueprint: blueprint(
          { content: 'Older copy.' },
          'acf/text-section',
          foreignEvidence
        ),
        updatedBlueprint: blueprint(
          { content: 'Refreshed copy.' },
          'acf/text-section',
          foreignEvidence
        ),
        confirmedPlan,
      })
    ).toThrow('does not retain an exact claim from its pinned evidence')
  })

  it('allows edits to copy grounded on caller-verified knowledge-base ids', () => {
    const knowledgeBaseEvidence = ['55555555-5555-4555-8555-555555555555']
    const run = (verifiedEvidenceIds?: readonly string[]) => () =>
      assertFactualSemanticEditGrounding({
        originalBlueprint: blueprint(
          { content: 'Older copy.' },
          'acf/text-section',
          knowledgeBaseEvidence
        ),
        updatedBlueprint: blueprint(
          { content: 'Refreshed grounded copy.' },
          'acf/text-section',
          knowledgeBaseEvidence
        ),
        confirmedPlan,
        verifiedEvidenceIds,
      })
    expect(run(knowledgeBaseEvidence)).not.toThrow()
    expect(run()).toThrow(
      'does not retain an exact claim from its pinned evidence'
    )
  })

  it('requires source workflows for inventory and POI changes', () => {
    expect(() =>
      assertFactualSemanticEditGrounding({
        originalBlueprint: blueprint(
          { inventory_content_hash: 'a'.repeat(64), floor_plans: [] },
          'acf/plans-availability'
        ),
        updatedBlueprint: blueprint(
          {
            inventory_content_hash: 'b'.repeat(64),
            floor_plans: [{ name: 'Invented', rent_min: 1 }],
          },
          'acf/plans-availability'
        ),
        confirmedPlan,
      })
    ).toThrow('source-managed factual data')
  })
})
