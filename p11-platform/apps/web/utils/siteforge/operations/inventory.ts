import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

export type InventoryProvider = 'siteforge' | 'manual' | 'csv' | 'yardi' | 'rentcafe'

export interface InventoryUnit {
  id: string
  rentMin?: number
  rentMax?: number
  availableCount?: number
  effectiveAt?: string
  expiresAt?: string
  sourceUpdatedAt?: string
  [key: string]: unknown
}

export interface InventoryAdapter {
  readonly provider: InventoryProvider
  fetch(propertyId: string): Promise<{
    sourceWatermark: string
    units: InventoryUnit[]
  }>
}

export class InventoryProviderNotConfiguredError extends Error {
  constructor(provider: 'yardi' | 'rentcafe') {
    super(`${provider} inventory adapter is not configured; refusing synthetic inventory`)
  }
}

abstract class UnconfiguredInventoryAdapter implements InventoryAdapter {
  abstract readonly provider: 'yardi' | 'rentcafe'
  async fetch(_propertyId: string): Promise<never> {
    void _propertyId
    throw new InventoryProviderNotConfiguredError(this.provider)
  }
}

export class YardiInventoryAdapter extends UnconfiguredInventoryAdapter {
  readonly provider = 'yardi' as const
}

export class RentCafeInventoryAdapter extends UnconfiguredInventoryAdapter {
  readonly provider = 'rentcafe' as const
}

export function getExternalInventoryAdapter(
  provider: 'yardi' | 'rentcafe'
): InventoryAdapter {
  return provider === 'yardi'
    ? new YardiInventoryAdapter()
    : new RentCafeInventoryAdapter()
}

function unitFreshness(unit: InventoryUnit, now: Date, maxAgeHours: number) {
  const sourceDate = unit.sourceUpdatedAt || unit.effectiveAt
  const sourceStale =
    !sourceDate ||
    now.getTime() - new Date(sourceDate).getTime() > maxAgeHours * 3_600_000
  const expired = Boolean(unit.expiresAt && new Date(unit.expiresAt) <= now)
  return { stale: sourceStale || expired, sourceDate, expired }
}

export function enforceInventoryFreshness(
  units: readonly InventoryUnit[],
  options: {
    propertyId: string
    provider: InventoryProvider
    maxAgeHours: number
    now?: Date
  }
) {
  const now = options.now || new Date()
  const staleUnitIds: string[] = []
  const safeUnits = units.map((unit) => {
    const freshness = unitFreshness(unit, now, options.maxAgeHours)
    if (!freshness.stale) return Object.freeze({ ...unit })
    staleUnitIds.push(unit.id)
    const withoutVolatilePricing = Object.fromEntries(
      Object.entries(unit).filter(
        ([key]) => !['rentMin', 'rentMax', 'availableCount'].includes(key)
      )
    )
    return Object.freeze({
      ...withoutVolatilePricing,
      pricingHiddenReason: 'stale_inventory',
    })
  })
  const proposalBody = {
    kind: 'siteforge_inventory_revision',
    propertyId: options.propertyId,
    provider: options.provider,
    detectedAt: now.toISOString(),
    maxAgeHours: options.maxAgeHours,
    staleUnitIds: [...staleUnitIds].sort(),
    action: 'hide_stale_pricing_and_request_inventory_refresh',
  }
  const revisionProposal = Object.freeze({
    ...proposalBody,
    proposalHash: hashSiteForgeContent(proposalBody),
  })
  return Object.freeze({
    units: Object.freeze(safeUnits),
    stale: staleUnitIds.length > 0,
    revisionProposal,
  })
}
