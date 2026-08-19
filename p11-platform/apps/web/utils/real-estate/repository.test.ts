import { describe, expect, it } from 'vitest'
import {
  FOR_SALE_OFFERING_GRAPH_FIXTURE_V1,
  FOR_SALE_PUBLICATION_POLICY_FIXTURE_V1,
  MULTIFAMILY_OFFERING_FIXTURE_V1,
} from '@/fixtures/real-estate-offering-parity.v1'
import { forSaleOfferingGraphSchema } from './contracts'
import { publishForSaleOfferingGraph } from './repository'

describe('provider-neutral real-estate offering parity', () => {
  it('models the complete for-sale hierarchy without provider field names', () => {
    const graph = forSaleOfferingGraphSchema.parse(
      FOR_SALE_OFFERING_GRAPH_FIXTURE_V1
    )

    expect(new Set(graph.nodes.map(node => node.kind))).toEqual(
      new Set([
        'community',
        'neighborhood',
        'home_collection',
        'plan',
        'elevation',
        'quick_move_in_home',
        'homesite',
        'builder',
      ])
    )
    expect(graph.pricing[0]).toMatchObject({ qualifier: 'from', amount: 525_000 })
    expect(graph.availability[0]?.state).toBe('available')
    expect(graph.lifecycleStates[0]).toMatchObject({
      releaseState: 'released',
      constructionState: 'under_construction',
    })
  })

  it('omits stale volatile facts and adds required disclosures', () => {
    const result = publishForSaleOfferingGraph(
      FOR_SALE_OFFERING_GRAPH_FIXTURE_V1,
      FOR_SALE_PUBLICATION_POLICY_FIXTURE_V1,
      new Date('2026-08-19T13:00:00.000Z')
    )

    expect(result.graph.pricing).toEqual([])
    expect(result.graph.availability).toEqual([])
    expect(result.graph.lifecycleStates).toHaveLength(1)
    expect(result.omissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: 'pricing', reason: 'stale' }),
        expect.objectContaining({ dimension: 'availability', reason: 'stale' }),
      ])
    )
    expect(result.disclosureCodes).toEqual([
      'pricing_subject_to_change',
      'volatile_facts_omitted',
    ])
  })

  it('keeps the paired multifamily fixture on the existing rental contract', () => {
    expect(MULTIFAMILY_OFFERING_FIXTURE_V1).toMatchObject({
      canonical_key: 'aspen-a1',
      rent_min: 1_895,
      available_count: 2,
      source: 'yardi',
    })
    expect(MULTIFAMILY_OFFERING_FIXTURE_V1).not.toHaveProperty('transaction')
  })
})
