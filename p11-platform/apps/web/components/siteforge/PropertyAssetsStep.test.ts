import { describe, expect, it } from 'vitest'
import {
  buildManualFloorPlanPreviewRows,
  existingUnitToFloorPlanDraft,
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
  it('hydrates manual setup from existing approved floor plans', () => {
    expect(
      existingUnitToFloorPlanDraft({
        id: 'unit-1',
        unit_type: 'S1 Studio',
        bedrooms: 0,
        bathrooms: '1.0',
        sqft_min: 525,
        sqft_max: 525,
        rent_min: '1850.00',
        rent_max: '2050.00',
        available_count: 3,
        move_in_specials: null,
        floor_plan_image_url: 'https://example.com/s1.webp',
        floor_plan_image_asset_id: null,
        floor_plan_image_alt: 'S1 floor plan',
        availability_url: null,
        apply_url: null,
        active: true,
        review_status: 'approved',
      })
    ).toMatchObject({
      id: 'unit-1',
      name: 'S1 Studio',
      bedrooms: '0',
      bathrooms: '1.0',
      sqftMin: '525',
      rentMin: '1850.00',
      imageUrl: 'https://example.com/s1.webp',
    })
  })

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
