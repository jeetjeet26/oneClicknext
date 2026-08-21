import { describe, expect, it } from 'vitest'
import { mergeSearchSourcesIntoAnswer, reconcileCitationFlags, scoreAnswer, scoreCollapsedMetrics } from './evaluator'
import type { AnswerBlock, EvaluationContext } from './types'

const context: EvaluationContext = {
  brandName: 'Epoca',
  brandDomains: ['epocalife.com'],
  competitors: [],
}

function block(overrides: Partial<AnswerBlock> = {}): AnswerBlock {
  return {
    ordered_entities: [
      { name: 'Epoca', domain: 'epocalife.com', rationale: 'brand', position: 2 },
    ],
    citations: [
      { url: 'https://zillow.com/x', domain: 'zillow.com', entity_ref: '' },
      { url: 'https://epocalife.com', domain: 'epocalife.com', entity_ref: 'Epoca' },
    ],
    answer_summary: 'Epoca is a master plan in San Diego.',
    notes: { flags: [] },
    ...overrides,
  }
}

describe('evaluator scoring', () => {
  it('scores mention position, owned link, SOV, and accuracy', () => {
    const scored = scoreAnswer(block(), context)
    expect(scored.presence).toBe(true)
    expect(scored.llmRank).toBe(2)
    expect(scored.linkRank).toBe(2)
    expect(scored.sov).toBe(0.5)
    expect(scored.score).toBeCloseTo(90 * 0.45 + 90 * 0.25 + 50 * 0.2 + 100 * 0.1, 5)
  })

  it('scores collapsed metrics with the same weights', () => {
    const scored = scoreCollapsedMetrics({
      llmRank: 1,
      linkRank: null,
      sov: null,
      flags: [],
    })
    expect(scored.score).toBe(55)
    expect(scored.breakdown.position).toBe(100)
    expect(scored.breakdown.accuracy).toBe(100)
  })

  it('reconciles no_sources from the final citation list', () => {
    expect(reconcileCitationFlags(['no_sources', 'outdated_info'], 3)).toEqual(['outdated_info'])
    expect(reconcileCitationFlags([], 0)).toEqual(['no_sources'])
    expect(reconcileCitationFlags(['possible_hallucination'], 0)).toEqual(['possible_hallucination', 'no_sources'])
  })

  it('recovers rank from prose when ordered_entities is empty', () => {
    const scored = scoreAnswer(block({
      ordered_entities: [],
      notes: { flags: ['possible_hallucination'] },
    }), context)

    expect(scored.presence).toBe(true)
    expect(scored.llmRank).toBe(1)
    expect(scored.flags).not.toContain('possible_hallucination')
  })

  it('drops no_sources after merging API citations into sourceless prose', () => {
    const merged = mergeSearchSourcesIntoAnswer(
      block({
        citations: [],
        notes: { flags: ['no_sources'] },
        answer_summary: 'Epoca is a master plan in San Diego with no URLs in the prose.',
      }),
      [{ url: 'https://epocalife.com', domain: 'epocalife.com' }]
    )

    expect(merged.notes.flags).toEqual([])
    expect(merged.citations).toHaveLength(1)
    const scored = scoreAnswer(merged, context)
    expect(scored.flags).not.toContain('no_sources')
    expect(scored.linkRank).toBe(1)
    expect(scored.sov).toBe(1)
  })
})
