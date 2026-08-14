import { describe, expect, it, vi } from 'vitest'
import { loadApprovedFloorPlanSnapshot } from './floor-plan-repository'

describe('loadApprovedFloorPlanSnapshot', () => {
  it('loads only active approved rows into the immutable artifact snapshot', async () => {
    const query: Record<string, ReturnType<typeof vi.fn>> = {}
    query.select = vi.fn(() => query)
    query.eq = vi.fn(() => query)
    query.order = vi.fn().mockResolvedValue({
      data: [
        {
          canonical_key: 'aspen-a1',
          unit_type: 'Aspen',
          bedrooms: 1,
          bathrooms: 1,
          sqft_min: 720,
          sqft_max: null,
          rent_min: 1_895,
          rent_max: null,
          available_count: 2,
          move_in_specials: null,
          floor_plan_image_url: null,
          floor_plan_image_alt: null,
          availability_url: null,
          apply_url: null,
          effective_at: '2026-07-31T11:00:00.000Z',
          expires_at: '2026-08-01T11:00:00.000Z',
          source_updated_at: null,
          source: 'manual',
          source_identity: 'approved-import:aspen',
        },
        {
          canonical_key: 'synthetic-seed',
          unit_type: 'Synthetic',
          bedrooms: 1,
          bathrooms: 1,
          sqft_min: 700,
          sqft_max: 700,
          rent_min: 1,
          rent_max: 1,
          available_count: 1,
          move_in_specials: null,
          floor_plan_image_url: null,
          floor_plan_image_asset_id: null,
          floor_plan_image_alt: null,
          availability_url: null,
          apply_url: null,
          effective_at: '2026-07-31T11:00:00.000Z',
          expires_at: null,
          source_updated_at: null,
          source: 'manual',
          source_identity: 'siteforge_test_seed',
        },
      ],
      error: null,
    })
    const client = { from: vi.fn(() => query) }

    const snapshot = await loadApprovedFloorPlanSnapshot(
      '22222222-2222-4222-8222-222222222222',
      client as never,
      '2026-07-31T12:00:00.000Z'
    )

    expect(client.from).toHaveBeenCalledWith('property_units')
    expect(query.eq).toHaveBeenCalledWith('active', true)
    expect(query.eq).toHaveBeenCalledWith('review_status', 'approved')
    expect(snapshot.rows).toEqual([
      expect.objectContaining({
        id: 'aspen-a1',
        rentMin: 1_895,
        source: 'manual',
        sourceIdentity: 'approved-import:aspen',
        effectiveAt: '2026-07-31T11:00:00.000Z',
        expiresAt: '2026-08-01T11:00:00.000Z',
      }),
    ])
    expect(Object.isFrozen(snapshot.rows)).toBe(true)
  })
})
