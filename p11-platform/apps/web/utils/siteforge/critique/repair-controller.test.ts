import { describe, expect, it, vi } from 'vitest'
import type {
  SemanticBlueprintPatchOperation,
  SiteBlueprint,
} from '@/types/siteforge'
import {
  normalizeRepairFindings,
  runBoundedAutonomousRepair,
  scoreRepairQuality,
  type RepairEvaluation,
} from './repair-controller'

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

const variantOperation: SemanticBlueprintPatchOperation = {
  version: 2,
  op: 'section.update',
  sectionId: 'intro',
  value: { variant: 'lead' },
  reasoning: 'Use a supported presentation variant.',
}

function evaluation(input: Partial<RepairEvaluation> = {}): RepairEvaluation {
  return {
    proposals: [],
    costUsd: 0,
    ...input,
  }
}

describe('bounded autonomous critique repair', () => {
  it('normalizes deterministic, browser, and model findings and scores brand dimensions', () => {
    const findings = normalizeRepairFindings({
      deterministic: [
        {
          id: 'brand-fidelity',
          category: 'fidelity',
          passed: false,
          severity: 'major',
          message: 'Approved brand tokens diverge.',
          locations: ['theme.tokens'],
        },
      ],
      browser: [
        {
          id: 'browser-hierarchy',
          category: 'hierarchy',
          severity: 'minor',
          message: 'Heading hierarchy is weak.',
          locations: ['home'],
        },
      ],
      model: [
        {
          id: 'model-distinctiveness',
          source: 'provider',
          category: 'brand_distinctiveness',
          severity: 'moderate',
          title: 'Generic composition',
          critique: 'The composition does not express the approved brand.',
          evidence: [
            {
              pageUrl: 'https://example.com/',
              viewport: 'desktop',
              screenshotSha256: 'a'.repeat(64),
              screenshotIdentityDigest: 'b'.repeat(64),
              observation: 'Generic opening composition.',
            },
          ],
          affectedSectionIds: ['intro'],
          confidence: 1,
        },
      ],
    })
    const score = scoreRepairQuality(findings)

    expect(findings.map(finding => finding.source).sort()).toEqual([
      'browser',
      'deterministic',
      'model',
    ])
    expect(score.brandFidelity).toBe(76)
    expect(score.brandDistinctiveness).toBe(88)
    expect(score.overall).toBeLessThan(score.generalQuality)
  })

  it('applies only editor-validated low-risk semantic repairs when quality improves', async () => {
    const validateOperations = vi.fn()
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(
        evaluation({
          browser: [
            {
              id: 'hierarchy',
              category: 'hierarchy',
              severity: 'moderate',
              message: 'The opening treatment lacks hierarchy.',
              locations: ['intro'],
            },
          ],
          proposals: [
            {
              findingIds: ['hierarchy'],
              summary: 'Use the supported lead treatment.',
              operations: [variantOperation],
            },
          ],
          costUsd: 0.1,
        })
      )
      .mockResolvedValueOnce(
        evaluation({
          browser: [
            {
              id: 'hierarchy',
              category: 'hierarchy',
              severity: 'moderate',
              passed: true,
              message: 'The opening treatment has clear hierarchy.',
              locations: ['intro'],
            },
          ],
          costUsd: 0.1,
        })
      )

    const result = await runBoundedAutonomousRepair({
      blueprint,
      evaluate,
      validateOperations,
      limits: { maxCycles: 2, maxOperations: 1, maxCostUsd: 0.5 },
      now: () => '2026-08-17T12:00:00.000Z',
    })

    expect(result.stopReason).toBe('quality_satisfied')
    expect(result.appliedOperations).toEqual([variantOperation])
    expect(result.finalBlueprint.pages[0].sections[0].variant).toBe('lead')
    expect(result.finalScore.overall).toBeGreaterThan(result.initialScore.overall)
    expect(result.cycles[0].decisions[0].decision).toBe('applied')
    expect(validateOperations).toHaveBeenCalledOnce()
    expect(evaluate).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ remainingCostUsd: 0.4 })
    )
  })

  it('blocks protected facts, legal, inventory, rights, credentials, runtime, and production identity domains', async () => {
    const protectedDomains = [
      'facts',
      'legal',
      'inventory',
      'rights',
      'credentials',
      'runtime',
      'production identity',
    ]
    for (const domain of protectedDomains) {
      const result = await runBoundedAutonomousRepair({
        blueprint,
        evaluate: async () =>
          evaluation({
            browser: [
              {
                id: domain,
                category: domain,
                severity: 'minor',
                message: `Repair ${domain}.`,
                locations: ['intro'],
              },
            ],
            proposals: [
              {
                findingIds: [domain],
                summary: `Repair ${domain}.`,
                operations: [variantOperation],
              },
            ],
          }),
        validateOperations: vi.fn(),
      })
      expect(result.stopReason).toBe('no_eligible_operations')
      expect(result.appliedOperations).toHaveLength(0)
      expect(result.cycles[0].decisions[0].reasons).toContain(
        'finding_touches_protected_domain'
      )
    }
  })

  it('reverts a candidate that breaks a blocker which previously passed', async () => {
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(
        evaluation({
          deterministic: [
            {
              id: 'legal-pass',
              category: 'compliance',
              severity: 'blocker',
              passed: true,
              message: 'Approved legal content remains exact.',
            },
          ],
          browser: [
            {
              id: 'hierarchy',
              category: 'hierarchy',
              severity: 'minor',
              message: 'Hierarchy can improve.',
            },
          ],
          proposals: [
            {
              findingIds: ['hierarchy'],
              summary: 'Use a supported variant.',
              operations: [variantOperation],
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        evaluation({
          deterministic: [
            {
              id: 'legal-pass',
              category: 'compliance',
              severity: 'blocker',
              passed: false,
              message: 'Approved legal content remains exact.',
            },
          ],
        })
      )

    const result = await runBoundedAutonomousRepair({
      blueprint,
      evaluate,
      validateOperations: vi.fn(),
    })

    expect(result.stopReason).toBe('blocker_regression')
    expect(result.finalBlueprint).toEqual(blueprint)
    expect(result.appliedOperations).toHaveLength(0)
    expect(result.cycles[0].blockerRegressions).toEqual(['legal-pass'])
    expect(result.cycles[0].decisions[0].decision).toBe('reverted')
  })

  it('detects repeated non-improving findings and enforces evaluation cost bounds', async () => {
    const repeatedEvaluation = evaluation({
      browser: [
        {
          id: 'hierarchy',
          category: 'hierarchy',
          severity: 'minor',
          message: 'Hierarchy remains weak.',
          locations: ['intro'],
        },
      ],
      proposals: [
        {
          findingIds: ['hierarchy'],
          summary: 'Use a supported variant.',
          operations: [variantOperation],
        },
      ],
      costUsd: 0.2,
    })
    const repeated = await runBoundedAutonomousRepair({
      blueprint,
      evaluate: async () => repeatedEvaluation,
      validateOperations: vi.fn(),
      limits: { maxCostUsd: 1 },
    })
    expect(repeated.stopReason).toBe('repeated_findings')
    expect(repeated.finalBlueprint).toEqual(blueprint)

    const overBudget = await runBoundedAutonomousRepair({
      blueprint,
      evaluate: async (_candidate, context) => {
        expect(context.remainingCostUsd).toBe(0.1)
        return { ...repeatedEvaluation, costUsd: 0.11 }
      },
      validateOperations: vi.fn(),
      limits: { maxCostUsd: 0.1 },
    })
    expect(overBudget.stopReason).toBe('cost_limit')
    expect(overBudget.cycles).toHaveLength(0)
  })
})
