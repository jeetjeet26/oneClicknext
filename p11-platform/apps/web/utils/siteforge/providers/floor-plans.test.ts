import { describe, expect, it } from 'vitest'
import {
  CsvFloorPlanAdapter,
  ManualFloorPlanAdapter,
  createApprovedFloorPlanSnapshot,
  createFloorPlanPreview,
  parseFloorPlanCsv,
} from './floor-plans'

describe('provider-neutral floor-plan adapters', () => {
  it('parses quoted CSV fields and normalizes a deterministic preview', () => {
    const csv = [
      'external_id,name,bedrooms,bathrooms,sqft_min,sqft_max,rent_min,image_url,image_alt',
      'A1,"The Aspen, Renovated",1,1,700,750,1895,https://cdn.example.com/a1.jpg,"Aspen one-bedroom floor plan"',
    ].join('\n')

    expect(parseFloorPlanCsv(csv)[0]?.name).toBe('The Aspen, Renovated')
    const preview = createFloorPlanPreview(new CsvFloorPlanAdapter(), csv)
    expect(preview.errors).toEqual([])
    expect(preview.rows[0]).toEqual(
      expect.objectContaining({
        canonical_key: 'a1',
        unit_type: 'The Aspen, Renovated',
        bedrooms: 1,
        confidence: 0.95,
      })
    )
    expect(preview.idempotencyKey).toMatch(/^[a-f0-9]{64}$/)
  })

  it('returns row-level errors and excludes invalid rows from confirmation', () => {
    const preview = createFloorPlanPreview(new ManualFloorPlanAdapter(), [
      {
        name: 'Studio',
        bedrooms: 0,
        sqftMin: 600,
        sqftMax: 500,
        imageUrl: 'https://cdn.example.com/studio.jpg',
      },
    ])

    expect(preview.rows).toEqual([])
    expect(preview.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 1, field: 'sqftMax' }),
        expect.objectContaining({ row: 1, field: 'imageAlt' }),
      ])
    )
  })

  it('flags duplicate canonical keys instead of letting confirm upsert fail', () => {
    const preview = createFloorPlanPreview(new ManualFloorPlanAdapter(), [
      { name: 'A1', bedrooms: 1, bathrooms: 1, sqftMin: 700 },
      { name: 'B2', bedrooms: 2, bathrooms: 2, sqftMin: 950 },
      { name: 'A1', bedrooms: 1, bathrooms: 1, sqftMin: 700 },
    ])

    expect(preview.rows.map(row => row.canonical_key)).toEqual([
      'a1-1br-1ba-700sf',
      'b2-2br-2ba-950sf',
    ])
    expect(preview.errors).toEqual([
      expect.objectContaining({
        row: 3,
        field: 'name',
        message: expect.stringContaining('also appears on row 1'),
      }),
    ])
  })

  it('rejects a confirmed-through date before the effective date', () => {
    const preview = createFloorPlanPreview(new ManualFloorPlanAdapter(), [
      {
        name: 'A1',
        bedrooms: 1,
        effectiveAt: '2026-08-18T00:00:00.000Z',
        expiresAt: '2026-08-17T00:00:00.000Z',
      },
    ])

    expect(preview.rows).toEqual([])
    expect(preview.errors).toEqual([
      expect.objectContaining({ field: 'expiresAt' }),
    ])
  })

  it('carries a trusted floor-plan image asset identity through preview', () => {
    const preview = createFloorPlanPreview(new ManualFloorPlanAdapter(), [
      {
        name: 'A1',
        bedrooms: 1,
        imageUrl: 'https://cdn.example.com/a1.jpg',
        imageAssetId: '11111111-1111-4111-8111-111111111111',
        imageAlt: 'A1 floor plan',
      },
    ])

    expect(preview.errors).toEqual([])
    expect(preview.rows[0]).toEqual(
      expect.objectContaining({
        floor_plan_image_asset_id:
          '11111111-1111-4111-8111-111111111111',
      })
    )
  })

  it('reports explicit stale-data state', () => {
    const freshness = new ManualFloorPlanAdapter().freshness(
      '2026-07-01T00:00:00.000Z',
      24,
      new Date('2026-07-03T00:00:00.000Z')
    )
    expect(freshness).toEqual({ stale: true, ageHours: 48 })
  })

  it('timestamps manual inventory so a new floor plan is fresh', () => {
    const capturedAt = '2026-08-13T18:00:00.000Z'
    const rows = new ManualFloorPlanAdapter().normalize(
      [{ name: 'A1', bedrooms: 1 }],
      capturedAt
    )

    expect(rows[0]).toMatchObject({
      effective_at: capturedAt,
      source_updated_at: capturedAt,
    })
  })

  it('creates a stable immutable snapshot from approved inventory rows', () => {
    const snapshot = createApprovedFloorPlanSnapshot(
      [
        {
          canonical_key: 'b2',
          unit_type: 'Birch',
          bedrooms: 2,
          bathrooms: 2,
          sqft_min: 1_000,
          sqft_max: 1_050,
          rent_min: 2_100,
          rent_max: 2_250,
          available_count: 3,
          move_in_specials: null,
          floor_plan_image_url: 'https://cdn.example.com/birch.png',
          floor_plan_image_asset_id: '11111111-1111-4111-8111-111111111111',
          floor_plan_image_alt: 'Birch two-bedroom floor plan',
          availability_url: 'https://property.example.com/availability',
          apply_url: 'https://property.example.com/apply',
          source: 'csv',
          source_identity: 'inventory-feed:birch',
          effective_at: '2026-07-31T11:00:00.000Z',
          expires_at: '2026-08-01T11:00:00.000Z',
          source_updated_at: '2026-07-31T10:30:00.000Z',
        },
        {
          canonical_key: 'a1',
          unit_type: 'Aspen',
          bedrooms: 1,
          bathrooms: 1,
          sqft_min: 700,
          sqft_max: null,
          rent_min: 1_800,
          rent_max: null,
          available_count: 1,
          move_in_specials: 'One month free',
          floor_plan_image_url: null,
          floor_plan_image_asset_id: null,
          floor_plan_image_alt: null,
          availability_url: null,
          apply_url: null,
          source: 'manual',
          source_identity: 'approved-import:aspen',
          effective_at: '2026-07-31T11:00:00.000Z',
          expires_at: null,
          source_updated_at: '2026-07-31T10:00:00.000Z',
        },
      ],
      '2026-07-31T12:00:00.000Z'
    )

    expect(snapshot.rows.map((row) => row.id)).toEqual(['a1', 'b2'])
    expect(snapshot.rows[0]).toEqual(
      expect.objectContaining({
        source: 'manual',
        sourceIdentity: 'approved-import:aspen',
        imageAssetId: undefined,
        effectiveAt: '2026-07-31T11:00:00.000Z',
        sourceUpdatedAt: '2026-07-31T10:00:00.000Z',
      })
    )
    expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.rows[0])).toBe(true)

    const changedProvenance = createApprovedFloorPlanSnapshot(
      [
        {
          canonical_key: 'a1',
          unit_type: 'Aspen',
          bedrooms: 1,
          bathrooms: 1,
          sqft_min: 700,
          sqft_max: null,
          rent_min: 1_800,
          rent_max: null,
          available_count: 1,
          move_in_specials: 'One month free',
          floor_plan_image_url: null,
          floor_plan_image_asset_id: null,
          floor_plan_image_alt: null,
          availability_url: null,
          apply_url: null,
          source: 'manual',
          source_identity: 'different-approved-import',
          effective_at: '2026-07-31T11:00:00.000Z',
          expires_at: null,
          source_updated_at: '2026-07-31T10:00:00.000Z',
        },
      ],
      '2026-07-31T12:00:00.000Z'
    )
    const originalAspen = createApprovedFloorPlanSnapshot(
      [
        {
          canonical_key: 'a1',
          unit_type: 'Aspen',
          bedrooms: 1,
          bathrooms: 1,
          sqft_min: 700,
          sqft_max: null,
          rent_min: 1_800,
          rent_max: null,
          available_count: 1,
          move_in_specials: 'One month free',
          floor_plan_image_url: null,
          floor_plan_image_asset_id: null,
          floor_plan_image_alt: null,
          availability_url: null,
          apply_url: null,
          source: 'manual',
          source_identity: 'approved-import:aspen',
          effective_at: '2026-07-31T11:00:00.000Z',
          expires_at: null,
          source_updated_at: '2026-07-31T10:00:00.000Z',
        },
      ],
      '2026-07-31T12:00:00.000Z'
    )
    expect(changedProvenance.contentHash).not.toBe(originalAspen.contentHash)
  })
})
