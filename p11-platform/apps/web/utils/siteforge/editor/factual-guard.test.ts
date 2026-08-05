import { describe, expect, it } from 'vitest'
import type { SiteBlueprint } from '@/types/siteforge'
import type { SiteForgePlan } from '@/utils/siteforge/contracts'
import { assertFactualSemanticEditGrounding } from './factual-guard'

function blueprint(content: Record<string, unknown>, acfBlock = 'acf/text-section') {
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
            evidenceIds: ['evidence-1'],
          },
        ],
      },
    ],
  } as unknown as SiteBlueprint
}

const confirmedPlan = {
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
