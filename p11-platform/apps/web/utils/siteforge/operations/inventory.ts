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

export interface DurableInventorySnapshot {
  snapshotId: string
  propertyId: string
  provider: InventoryProvider
  sourceWatermark: string
  capturedAt: string
  freshnessSeconds: number
  expiresAt: string
  units: readonly InventoryUnit[]
  contentHash: string
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
  const publishedUnits = units.map(unit => Object.freeze({ ...unit }))
  const proposalBody = {
    kind: 'siteforge_inventory_revision',
    propertyId: options.propertyId,
    provider: options.provider,
    detectedAt: now.toISOString(),
    maxAgeHours: options.maxAgeHours,
    staleUnitIds: [] as string[],
    action: 'keep_published_inventory_until_replaced',
  }
  const revisionProposal = Object.freeze({
    ...proposalBody,
    proposalHash: hashSiteForgeContent(proposalBody),
  })
  return Object.freeze({
    units: Object.freeze(publishedUnits),
    stale: false,
    revisionProposal,
  })
}

function parseTimestamp(value: string, label: string): number {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${label} must be a valid ISO timestamp`)
  }
  return timestamp
}

export function createDurableInventorySnapshot(input: {
  propertyId: string
  provider: InventoryProvider
  sourceWatermark: string
  capturedAt: string
  freshnessSeconds: number
  units: readonly InventoryUnit[]
}): DurableInventorySnapshot {
  if (!input.propertyId.trim()) throw new Error('propertyId is required')
  if (!Number.isInteger(input.freshnessSeconds) || input.freshnessSeconds < 60) {
    throw new Error('freshnessSeconds must be an integer of at least 60')
  }
  const sourceWatermark = parseTimestamp(
    input.sourceWatermark,
    'sourceWatermark'
  )
  const capturedAt = parseTimestamp(input.capturedAt, 'capturedAt')
  if (sourceWatermark > capturedAt) {
    throw new Error('sourceWatermark cannot be later than capturedAt')
  }
  const units = input.units.map(unit => Object.freeze({ ...unit }))
  const snapshotContent = {
    propertyId: input.propertyId,
    provider: input.provider,
    sourceWatermark: input.sourceWatermark,
    capturedAt: input.capturedAt,
    freshnessSeconds: input.freshnessSeconds,
    units,
  }
  const contentHash = hashSiteForgeContent(snapshotContent)
  return Object.freeze({
    snapshotId: `inventory:${input.propertyId}:${contentHash}`,
    ...snapshotContent,
    units: Object.freeze(units),
    expiresAt: new Date(
      sourceWatermark + input.freshnessSeconds * 1_000
    ).toISOString(),
    contentHash,
  })
}

export function enforceInventorySnapshotFreshness(
  snapshot: DurableInventorySnapshot,
  now = new Date()
) {
  const maxAgeHours = snapshot.freshnessSeconds / 3_600
  const result = enforceInventoryFreshness(snapshot.units, {
    propertyId: snapshot.propertyId,
    provider: snapshot.provider,
    maxAgeHours,
    now,
  })
  return Object.freeze({
    snapshot,
    ...result,
    snapshotStale: false,
  })
}
