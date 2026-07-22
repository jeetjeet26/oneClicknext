/**
 * Deterministic market change computation.
 *
 * Changes are computed from observation history (competitor_price_history)
 * BEFORE any LLM interpretation. Each change carries citations to the exact
 * history rows (and their evidence captures) that produced it.
 */

import type { MarketChange, MarketCitation, MarketMovement } from './domain-types'

export interface PriceHistoryRow {
  id: string
  competitor_unit_id: string
  rent_min: number | null
  rent_max: number | null
  available_count: number | null
  recorded_at: string | null
  capture_id?: string | null
}

export interface UnitRow {
  id: string
  competitor_id: string
  unit_type: string
  bedrooms: number | null
}

export interface CompetitorRow {
  id: string
  name: string
}

function daysBetween(fromIso: string, to: Date): number {
  const from = new Date(fromIso).getTime()
  return Math.max(0, Math.round((to.getTime() - from) / (24 * 60 * 60 * 1000)))
}

/**
 * Compute per-unit price/availability changes by comparing consecutive
 * observations in each unit's history, newest pair first.
 */
export function computeMarketChanges(input: {
  history: PriceHistoryRow[]
  units: UnitRow[]
  competitors: CompetitorRow[]
  now?: Date
}): MarketChange[] {
  const now = input.now ?? new Date()
  const unitById = new Map(input.units.map((u) => [u.id, u]))
  const competitorById = new Map(input.competitors.map((c) => [c.id, c]))

  // Group history by unit, ordered oldest -> newest.
  const byUnit = new Map<string, PriceHistoryRow[]>()
  for (const row of input.history) {
    if (!row.recorded_at) continue
    const rows = byUnit.get(row.competitor_unit_id) ?? []
    rows.push(row)
    byUnit.set(row.competitor_unit_id, rows)
  }

  const changes: MarketChange[] = []

  for (const [unitId, rows] of byUnit) {
    const unit = unitById.get(unitId)
    if (!unit) continue
    const competitor = competitorById.get(unit.competitor_id)
    if (!competitor) continue

    rows.sort((a, b) => (a.recorded_at || '').localeCompare(b.recorded_at || ''))

    // Compare the two most recent observations for this unit.
    if (rows.length < 2) continue
    const previous = rows[rows.length - 2]
    const current = rows[rows.length - 1]

    const citationFor = (row: PriceHistoryRow): MarketCitation => ({
      sourceKind: 'price_history',
      sourceId: row.id,
      captureId: row.capture_id ?? null,
      competitorId: competitor.id,
      competitorName: competitor.name,
      observedAt: row.recorded_at,
    })

    const citations = [citationFor(previous), citationFor(current)]
    const observedAt = current.recorded_at as string
    const freshnessDays = daysBetween(observedAt, now)

    // Price change
    if (
      previous.rent_min !== null &&
      current.rent_min !== null &&
      previous.rent_min !== current.rent_min
    ) {
      const changeAmount = current.rent_min - previous.rent_min
      const changePercent =
        previous.rent_min > 0
          ? Math.round((changeAmount / previous.rent_min) * 1000) / 10
          : null

      changes.push({
        changeType: changeAmount < 0 ? 'price_drop' : 'price_increase',
        competitorId: competitor.id,
        competitorName: competitor.name,
        unitType: unit.unit_type,
        bedrooms: unit.bedrooms,
        previousValue: previous.rent_min,
        currentValue: current.rent_min,
        changeAmount,
        changePercent,
        observedAt,
        freshnessDays,
        citations,
      })
    }

    // Availability change
    if (
      previous.available_count !== null &&
      current.available_count !== null &&
      previous.available_count !== current.available_count
    ) {
      changes.push({
        changeType: 'availability_change',
        competitorId: competitor.id,
        competitorName: competitor.name,
        unitType: unit.unit_type,
        bedrooms: unit.bedrooms,
        previousValue: previous.available_count,
        currentValue: current.available_count,
        changeAmount: current.available_count - previous.available_count,
        changePercent: null,
        observedAt,
        freshnessDays,
        citations,
      })
    }
  }

  // Rank: freshest, largest-magnitude price changes first.
  changes.sort((a, b) => {
    const magnitudeA = Math.abs(a.changePercent ?? 0)
    const magnitudeB = Math.abs(b.changePercent ?? 0)
    if (a.freshnessDays !== b.freshnessDays) return a.freshnessDays - b.freshnessDays
    return magnitudeB - magnitudeA
  })

  return changes
}

/**
 * Bedroom-aware market movement from computed price changes: replaces the
 * old alert-count heuristic with source-freshness- and coverage-aware
 * movement per bedroom count.
 */
export function computeMarketMovements(
  changes: MarketChange[],
  windowDays: number
): MarketMovement[] {
  const priceChanges = changes.filter(
    (c) =>
      (c.changeType === 'price_drop' || c.changeType === 'price_increase') &&
      c.bedrooms !== null &&
      c.changePercent !== null &&
      c.freshnessDays <= windowDays
  )

  const byBedrooms = new Map<number, MarketChange[]>()
  for (const change of priceChanges) {
    const key = change.bedrooms as number
    const list = byBedrooms.get(key) ?? []
    list.push(change)
    byBedrooms.set(key, list)
  }

  const movements: MarketMovement[] = []
  for (const [bedrooms, list] of byBedrooms) {
    const competitorsCovered = new Set(list.map((c) => c.competitorId)).size
    const netChangePct =
      Math.round(
        (list.reduce((sum, c) => sum + (c.changePercent ?? 0), 0) / list.length) * 10
      ) / 10

    let direction: MarketMovement['direction']
    if (list.length < 2 || competitorsCovered < 2) {
      direction = 'insufficient_data'
    } else if (netChangePct >= 1) {
      direction = 'rising'
    } else if (netChangePct <= -1) {
      direction = 'falling'
    } else {
      direction = 'stable'
    }

    movements.push({
      bedrooms,
      direction,
      netChangePct,
      observations: list.length,
      competitorsCovered,
      windowDays,
    })
  }

  movements.sort((a, b) => a.bedrooms - b.bedrooms)
  return movements
}
