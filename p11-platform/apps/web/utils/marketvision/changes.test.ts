import { describe, expect, it } from 'vitest'
import { computeMarketChanges, computeMarketMovements } from './changes'
import type { CompetitorRow, PriceHistoryRow, UnitRow } from './changes'

const NOW = new Date('2026-07-21T12:00:00Z')

const competitors: CompetitorRow[] = [
  { id: 'comp-1', name: 'Alpha Apartments' },
  { id: 'comp-2', name: 'Beta Flats' },
]

const units: UnitRow[] = [
  { id: 'unit-1', competitor_id: 'comp-1', unit_type: '1BR', bedrooms: 1 },
  { id: 'unit-2', competitor_id: 'comp-2', unit_type: '1BR Deluxe', bedrooms: 1 },
  { id: 'unit-3', competitor_id: 'comp-1', unit_type: '2BR', bedrooms: 2 },
]

function historyRow(overrides: Partial<PriceHistoryRow> & { id: string }): PriceHistoryRow {
  return {
    competitor_unit_id: 'unit-1',
    rent_min: null,
    rent_max: null,
    available_count: null,
    recorded_at: '2026-07-20T00:00:00Z',
    capture_id: null,
    ...overrides,
  }
}

describe('computeMarketChanges', () => {
  it('detects a price drop with citations to both observations', () => {
    const history = [
      historyRow({ id: 'h1', rent_min: 1500, recorded_at: '2026-07-10T00:00:00Z', capture_id: 'cap-1' }),
      historyRow({ id: 'h2', rent_min: 1400, recorded_at: '2026-07-20T00:00:00Z', capture_id: 'cap-2' }),
    ]

    const changes = computeMarketChanges({ history, units, competitors, now: NOW })

    expect(changes).toHaveLength(1)
    const change = changes[0]
    expect(change.changeType).toBe('price_drop')
    expect(change.previousValue).toBe(1500)
    expect(change.currentValue).toBe(1400)
    expect(change.changePercent).toBe(-6.7)
    expect(change.bedrooms).toBe(1)
    expect(change.freshnessDays).toBe(2) // 1.5 days rounds up
    expect(change.citations).toHaveLength(2)
    expect(change.citations[0].sourceId).toBe('h1')
    expect(change.citations[1].captureId).toBe('cap-2')
  })

  it('does not fabricate changes from a single observation', () => {
    const history = [historyRow({ id: 'h1', rent_min: 1500 })]
    const changes = computeMarketChanges({ history, units, competitors, now: NOW })
    expect(changes).toHaveLength(0)
  })

  it('detects availability changes separately from price changes', () => {
    const history = [
      historyRow({ id: 'h1', rent_min: 1500, available_count: 5, recorded_at: '2026-07-10T00:00:00Z' }),
      historyRow({ id: 'h2', rent_min: 1500, available_count: 2, recorded_at: '2026-07-20T00:00:00Z' }),
    ]

    const changes = computeMarketChanges({ history, units, competitors, now: NOW })

    expect(changes).toHaveLength(1)
    expect(changes[0].changeType).toBe('availability_change')
    expect(changes[0].changeAmount).toBe(-3)
  })
})

describe('computeMarketMovements', () => {
  it('reports insufficient data below two competitors', () => {
    const history = [
      historyRow({ id: 'h1', rent_min: 1500, recorded_at: '2026-07-10T00:00:00Z' }),
      historyRow({ id: 'h2', rent_min: 1400, recorded_at: '2026-07-20T00:00:00Z' }),
    ]
    const changes = computeMarketChanges({ history, units, competitors, now: NOW })
    const movements = computeMarketMovements(changes, 30)

    expect(movements).toHaveLength(1)
    expect(movements[0].direction).toBe('insufficient_data')
  })

  it('reports falling movement when multiple competitors drop prices', () => {
    const history = [
      historyRow({ id: 'h1', competitor_unit_id: 'unit-1', rent_min: 1500, recorded_at: '2026-07-10T00:00:00Z' }),
      historyRow({ id: 'h2', competitor_unit_id: 'unit-1', rent_min: 1400, recorded_at: '2026-07-20T00:00:00Z' }),
      historyRow({ id: 'h3', competitor_unit_id: 'unit-2', rent_min: 1600, recorded_at: '2026-07-12T00:00:00Z' }),
      historyRow({ id: 'h4', competitor_unit_id: 'unit-2', rent_min: 1500, recorded_at: '2026-07-19T00:00:00Z' }),
    ]
    const changes = computeMarketChanges({ history, units, competitors, now: NOW })
    const movements = computeMarketMovements(changes, 30)

    expect(movements).toHaveLength(1)
    expect(movements[0].bedrooms).toBe(1)
    expect(movements[0].direction).toBe('falling')
    expect(movements[0].competitorsCovered).toBe(2)
    expect(movements[0].netChangePct).toBeLessThan(-1)
  })

  it('is bedroom-aware: 2BR changes do not pollute 1BR movement', () => {
    const history = [
      historyRow({ id: 'h1', competitor_unit_id: 'unit-3', rent_min: 2000, recorded_at: '2026-07-10T00:00:00Z' }),
      historyRow({ id: 'h2', competitor_unit_id: 'unit-3', rent_min: 2200, recorded_at: '2026-07-20T00:00:00Z' }),
    ]
    const changes = computeMarketChanges({ history, units, competitors, now: NOW })
    const movements = computeMarketMovements(changes, 30)

    expect(movements).toHaveLength(1)
    expect(movements[0].bedrooms).toBe(2)
  })
})
