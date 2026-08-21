import { describe, expect, it } from 'vitest'
import {
  ensureOrderedEntities,
  finalizeAnswerBlock,
  findMentionIndex,
  findTrackedBrandPosition,
  reconcileHallucinationFlags,
} from './entity-fallback'

describe('entity fallback', () => {
  it('finds a brand mention without inventing one', () => {
    expect(findMentionIndex('Epoca is a master-planned community in Otay Mesa.', 'Epoca')).toBe(0)
    expect(findMentionIndex('Other communities nearby.', 'Epoca')).toBeNull()
  })

  it('rebuilds a ranked list from prose when the analyzer returned none', () => {
    const entities = ensureOrderedEntities({
      existing: [],
      brandName: 'Epoca',
      brandDomains: ['epocalife.com'],
      competitors: ['Pacific Highlands'],
      text: 'Pacific Highlands and then Epoca are both in South County.',
    })

    expect(entities.map(entity => entity.name)).toEqual(['Pacific Highlands', 'Epoca'])
    expect(findTrackedBrandPosition(entities, 'Epoca', ['epocalife.com'])).toBe(2)
  })

  it('keeps analyzer entities and inserts a missing mentioned brand', () => {
    const entities = ensureOrderedEntities({
      existing: [{ name: 'Millenia', domain: '', rationale: 'listed first', position: 1 }],
      brandName: 'Epoca',
      text: 'Millenia and Epoca both came up for Otay Mesa.',
    })

    expect(entities.map(entity => `${entity.position}:${entity.name}`)).toEqual([
      '1:Millenia',
      '2:Epoca',
    ])
  })

  it('uses analysis entities when answer_block is empty', () => {
    const entities = ensureOrderedEntities({
      existing: [],
      analysisEntities: [{ name: 'Epoca', domain: 'epocalife.com', position: 1 }],
      brandName: 'Epoca',
      text: 'Epoca is in Otay Mesa.',
    })

    expect(entities[0]?.name).toBe('Epoca')
    expect(entities[0]?.position).toBe(1)
  })

  it('drops possible_hallucination when the brand is actually named', () => {
    expect(reconcileHallucinationFlags(['possible_hallucination', 'outdated_info'], 'Epoca is in Otay Mesa.', 'Epoca'))
      .toEqual(['outdated_info'])
    expect(reconcileHallucinationFlags(['possible_hallucination'], 'No brand here.', 'Epoca'))
      .toEqual(['possible_hallucination'])
  })

  it('finalizes an empty answer block from the stored natural response', () => {
    const finalized = finalizeAnswerBlock({
      ordered_entities: [] as Array<{ name: string; domain: string; rationale: string; position: number }>,
      answer_summary: 'Epoca is a master plan in Otay Mesa, San Diego.',
      notes: { flags: ['possible_hallucination'] },
    }, {
      brandName: 'Epoca',
      brandDomains: ['epocalife.com'],
      sourceText: '## Epoca Master Plan — Otay Mesa, San Diego',
    })

    expect(finalized.ordered_entities[0]?.name).toBe('Epoca')
    expect(finalized.ordered_entities[0]?.position).toBe(1)
    expect(finalized.notes.flags).toEqual([])
  })
})
