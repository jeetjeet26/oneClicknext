import { describe, expect, it } from 'vitest'
import {
  buildManualFloorPlanPreviewRows,
  type FloorPlanDraft,
} from './PropertyAssetsStep'

function floorPlan(overrides: Partial<FloorPlanDraft> = {}): FloorPlanDraft {
  return {
    id: 'floor-plan-1',
    name: 'A1',
    bedrooms: '1',
    bathrooms: '1',
    sqftMin: '700',
    sqftMax: '750',
    rentMin: '1800',
    rentMax: '1950',
    availableCount: '2',
    specials: '',
    imageUrl: 'https://example.com/a1.png',
    imageAssetId: '11111111-1111-4111-8111-111111111111',
    imageAlt: 'A1 floor plan',
    availabilityUrl: '',
    applyUrl: '',
    ...overrides,
  }
}

describe('floor-plan preview policy', () => {
  it('includes an uploaded layout without requiring asset approval state', () => {
    expect(buildManualFloorPlanPreviewRows([floorPlan()])).toEqual([
      expect.objectContaining({
        name: 'A1',
        imageUrl: 'https://example.com/a1.png',
        imageAssetId: '11111111-1111-4111-8111-111111111111',
        imageAlt: 'A1 floor plan',
      }),
    ])
  })
})
