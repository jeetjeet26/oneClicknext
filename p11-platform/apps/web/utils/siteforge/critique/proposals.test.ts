import { describe, expect, it } from 'vitest'
import type {
  SemanticBlueprintPatchOperation,
  SiteBlueprint,
} from '@/types/siteforge'
import { buildSupervisedRepairProposals } from './proposals'

const blueprint: SiteBlueprint = {
  version: 1,
  pages: [
    {
      slug: 'home',
      title: 'Home',
      purpose: 'Introduce the property',
      sections: [
        {
          id: 'intro',
          type: 'intro',
          acfBlock: 'acf/text-section',
          variant: 'editorial',
          content: {
            headline: 'Welcome home',
            content: 'Explore documented property details.',
            layout: 'center',
            background: 'white',
          },
          reasoning: 'Introduce the property',
          order: 1,
          evidenceIds: ['evidence-1'],
        },
      ],
    },
  ],
}

describe('supervised critique proposal bounds', () => {
  it('caps proposals and operations while rejecting destructive semantics', () => {
    const validOperation: SemanticBlueprintPatchOperation = {
      version: 2,
      op: 'section.update',
      sectionId: 'intro',
      value: { variant: 'lead' },
    }
    const proposals = buildSupervisedRepairProposals({
      blueprint,
      artifactId: '11111111-1111-4111-8111-111111111111',
      contentHash: 'a'.repeat(64),
      evidenceDigest: 'b'.repeat(64),
      drafts: [
        ...Array.from({ length: 20 }, (_, index) => ({
          findingIds: [`finding-${index}`],
          summary: `Bounded repair ${index}`,
          operations: [validOperation],
        })),
        {
          findingIds: ['destructive'],
          summary: 'Remove content',
          operations: [
            {
              version: 2,
              op: 'section.remove',
              sectionId: 'intro',
            } as SemanticBlueprintPatchOperation,
          ],
        },
      ],
      validFindingIds: new Set([
        ...Array.from({ length: 20 }, (_, index) => `finding-${index}`),
        'destructive',
      ]),
      pages: ['https://example.com/'],
      viewports: ['desktop', 'tablet', 'mobile'],
    })

    expect(proposals).toHaveLength(8)
    expect(
      proposals.reduce(
        (total, proposal) => total + proposal.operations.length,
        0
      )
    ).toBeLessThanOrEqual(12)
    expect(
      proposals.flatMap(proposal => proposal.operations).some(operation =>
        operation.op.includes('remove')
      )
    ).toBe(false)
  })
})
