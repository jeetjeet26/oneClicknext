import { describe, expect, it } from 'vitest'
import { getCriticalPreviewState } from './ACFBlockRenderer'

describe('ACFBlockRenderer critical preview state', () => {
  it('marks hero degraded when slides are missing', () => {
    expect(getCriticalPreviewState('acf/top-slides', {})).toEqual({
      degraded: true,
      reason: 'missing_hero_slides',
    })
  })

  it('marks map degraded when location data is missing', () => {
    expect(getCriticalPreviewState('acf/map', { zoom_level: 15 })).toEqual({
      degraded: true,
      reason: 'missing_map_location',
    })
  })

  it('marks plans degraded when floor-plan inventory is missing', () => {
    expect(getCriticalPreviewState('acf/plans-availability', { data_source: 'yardi' })).toEqual({
      degraded: true,
      reason: 'missing_floor_plan_inventory',
    })
  })

  it('keeps plans healthy when floor plans are provided', () => {
    expect(
      getCriticalPreviewState('acf/plans-availability', {
        floor_plans: [{ id: 'plan-a', bedrooms: 1 }],
      })
    ).toEqual({ degraded: false })
  })
})
