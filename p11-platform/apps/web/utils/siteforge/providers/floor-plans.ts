import { z } from 'zod'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

const optionalUrl = z.preprocess(
  (value) => (value === '' || value == null ? undefined : value),
  z.string().url().optional()
)
const optionalNumber = z.preprocess(
  (value) => (value === '' || value == null ? undefined : value),
  z.coerce.number().nonnegative().optional()
)

export const floorPlanInputRowSchema = z
  .object({
    externalId: z.string().trim().max(200).optional(),
    name: z.string().trim().min(1).max(200),
    bedrooms: z.coerce.number().int().min(0).max(20),
    bathrooms: z.coerce.number().min(0).max(20).optional(),
    sqftMin: optionalNumber,
    sqftMax: optionalNumber,
    rentMin: optionalNumber,
    rentMax: optionalNumber,
    availableCount: z.preprocess(
      (value) => (value === '' || value == null ? undefined : value),
      z.coerce.number().int().nonnegative().optional()
    ),
    specials: z.string().trim().max(2000).optional(),
    imageUrl: optionalUrl,
    imageAlt: z.string().trim().max(300).optional(),
    availabilityUrl: optionalUrl,
    applyUrl: optionalUrl,
    effectiveAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional(),
    sourceUpdatedAt: z.string().datetime().optional(),
  })
  .superRefine((row, context) => {
    if (row.sqftMin != null && row.sqftMax != null && row.sqftMin > row.sqftMax) {
      context.addIssue({
        code: 'custom',
        path: ['sqftMax'],
        message: 'sqftMax must be greater than or equal to sqftMin',
      })
    }
    if (row.rentMin != null && row.rentMax != null && row.rentMin > row.rentMax) {
      context.addIssue({
        code: 'custom',
        path: ['rentMax'],
        message: 'rentMax must be greater than or equal to rentMin',
      })
    }
    if (row.imageUrl && !row.imageAlt) {
      context.addIssue({
        code: 'custom',
        path: ['imageAlt'],
        message: 'imageAlt is required when imageUrl is provided',
      })
    }
  })

export type FloorPlanInputRow = z.input<typeof floorPlanInputRowSchema>
export type ValidFloorPlanInputRow = z.output<typeof floorPlanInputRowSchema>

export interface NormalizedFloorPlan {
  unit_type: string
  bedrooms: number
  bathrooms?: number
  sqft_min?: number
  sqft_max?: number
  rent_min?: number
  rent_max?: number
  available_count?: number
  move_in_specials?: string
  external_id?: string
  canonical_key: string
  floor_plan_image_url?: string
  floor_plan_image_alt?: string
  availability_url?: string
  apply_url?: string
  effective_at: string
  expires_at?: string
  source_updated_at?: string
  confidence: number
  review_status: 'pending' | 'approved'
}

export interface PublishedFloorPlanRow {
  id: string
  name: string
  bedrooms: number
  bathrooms?: number
  sqftMin?: number
  sqftMax?: number
  rentMin?: number
  rentMax?: number
  availableCount?: number
  specials?: string
  imageUrl?: string
  imageAlt?: string
  availabilityUrl?: string
  applyUrl?: string
  source?: string
  sourceIdentity?: string
  effectiveAt?: string
  expiresAt?: string
  sourceUpdatedAt?: string
}

export interface ApprovedFloorPlanSnapshot {
  capturedAt: string
  contentHash: string
  rows: readonly PublishedFloorPlanRow[]
}

export interface FloorPlanRowError {
  row: number
  field?: string
  message: string
}

export interface FloorPlanPreview {
  rows: NormalizedFloorPlan[]
  errors: FloorPlanRowError[]
  idempotencyKey: string
}

export interface FloorPlanApplyPort {
  apply(rows: NormalizedFloorPlan[]): Promise<{ applied: number }>
}

export interface FloorPlanSourceAdapter<Input> {
  readonly sourceType: 'manual' | 'csv'
  preview(input: Input): unknown[]
  validate(rows: unknown[]): FloorPlanRowError[]
  normalize(rows: unknown[], now?: string): NormalizedFloorPlan[]
  apply(
    input: Input,
    port: FloorPlanApplyPort
  ): Promise<{ applied: number; preview: FloorPlanPreview }>
  freshness(
    sourceUpdatedAt: string | null,
    maxAgeHours: number,
    now?: Date
  ): { stale: boolean; ageHours: number | null }
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function canonicalKey(row: ValidFloorPlanInputRow): string {
  if (row.externalId) return slug(row.externalId)
  return [
    slug(row.name),
    `${row.bedrooms}br`,
    row.bathrooms == null ? 'na-ba' : `${row.bathrooms}ba`,
    row.sqftMin == null ? 'na-sf' : `${row.sqftMin}sf`,
  ].join('-')
}

abstract class BaseFloorPlanAdapter<Input>
  implements FloorPlanSourceAdapter<Input>
{
  abstract readonly sourceType: 'manual' | 'csv'
  abstract preview(input: Input): unknown[]

  validate(rows: unknown[]): FloorPlanRowError[] {
    return rows.flatMap((row, index) => {
      const parsed = floorPlanInputRowSchema.safeParse(row)
      if (parsed.success) return []
      return parsed.error.issues.map((issue) => ({
        row: index + 1,
        field: issue.path.join('.') || undefined,
        message: issue.message,
      }))
    })
  }

  normalize(rows: unknown[], now = new Date().toISOString()): NormalizedFloorPlan[] {
    return rows.map((row) => {
      const parsed = floorPlanInputRowSchema.parse(row)
      return {
        unit_type: parsed.name,
        bedrooms: parsed.bedrooms,
        bathrooms: parsed.bathrooms,
        sqft_min: parsed.sqftMin,
        sqft_max: parsed.sqftMax,
        rent_min: parsed.rentMin,
        rent_max: parsed.rentMax,
        available_count: parsed.availableCount,
        move_in_specials: parsed.specials,
        external_id: parsed.externalId,
        canonical_key: canonicalKey(parsed),
        floor_plan_image_url: parsed.imageUrl,
        floor_plan_image_alt: parsed.imageAlt,
        availability_url: parsed.availabilityUrl,
        apply_url: parsed.applyUrl,
        effective_at: parsed.effectiveAt || now,
        expires_at: parsed.expiresAt,
        source_updated_at: parsed.sourceUpdatedAt,
        confidence: this.sourceType === 'manual' ? 1 : 0.95,
        review_status: 'approved',
      }
    })
  }

  async apply(
    input: Input,
    port: FloorPlanApplyPort
  ): Promise<{ applied: number; preview: FloorPlanPreview }> {
    const preview: FloorPlanPreview = createFloorPlanPreview(this, input)
    if (preview.errors.length) {
      throw new Error('Floor-plan input contains validation errors')
    }
    return {
      ...(await port.apply(preview.rows)),
      preview,
    }
  }

  freshness(
    sourceUpdatedAt: string | null,
    maxAgeHours: number,
    now = new Date()
  ) {
    if (!sourceUpdatedAt) return { stale: true, ageHours: null }
    const ageHours = Math.max(
      0,
      (now.getTime() - new Date(sourceUpdatedAt).getTime()) / 3_600_000
    )
    return { stale: ageHours > maxAgeHours, ageHours }
  }
}

export class ManualFloorPlanAdapter extends BaseFloorPlanAdapter<unknown[]> {
  readonly sourceType = 'manual' as const
  preview(input: unknown[]) {
    return input
  }
}

const csvHeaders: Record<string, keyof ValidFloorPlanInputRow> = {
  external_id: 'externalId',
  name: 'name',
  floor_plan: 'name',
  bedrooms: 'bedrooms',
  bathrooms: 'bathrooms',
  sqft_min: 'sqftMin',
  sqft_max: 'sqftMax',
  rent_min: 'rentMin',
  rent_max: 'rentMax',
  available_count: 'availableCount',
  specials: 'specials',
  image_url: 'imageUrl',
  image_alt: 'imageAlt',
  availability_url: 'availabilityUrl',
  apply_url: 'applyUrl',
  effective_at: 'effectiveAt',
  expires_at: 'expiresAt',
  source_updated_at: 'sourceUpdatedAt',
}

export function parseFloorPlanCsv(csv: string): Array<Record<string, string>> {
  const matrix: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      row.push(field)
      field = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && csv[index + 1] === '\n') index += 1
      row.push(field)
      if (row.some((value) => value.trim())) matrix.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }
  row.push(field)
  if (row.some((value) => value.trim())) matrix.push(row)
  if (quoted) throw new Error('CSV contains an unterminated quoted field')
  if (matrix.length < 2) return []

  const headers = matrix[0].map((header) => header.trim().toLowerCase())
  return matrix.slice(1).map((values) =>
    Object.fromEntries(
      headers.flatMap((header, index) => {
        const mapped = csvHeaders[header]
        return mapped ? [[mapped, values[index]?.trim() || '']] : []
      })
    )
  )
}

export class CsvFloorPlanAdapter extends BaseFloorPlanAdapter<string> {
  readonly sourceType = 'csv' as const
  preview(input: string) {
    return parseFloorPlanCsv(input)
  }
}

export function createFloorPlanPreview<Input>(
  adapter: FloorPlanSourceAdapter<Input>,
  input: Input
): FloorPlanPreview {
  const rawRows = adapter.preview(input)
  const errors = adapter.validate(rawRows)
  const invalidRows = new Set(errors.map((error) => error.row))
  const rows = rawRows.flatMap((row, index) =>
    invalidRows.has(index + 1) ? [] : adapter.normalize([row])
  )
  return {
    rows,
    errors,
    idempotencyKey: hashSiteForgeContent({
      sourceType: adapter.sourceType,
      rows,
    }),
  }
}

type ApprovedPropertyUnit = {
  canonical_key: string
  unit_type: string
  bedrooms: number
  bathrooms: number | null
  sqft_min: number | null
  sqft_max: number | null
  rent_min: number | null
  rent_max: number | null
  available_count: number | null
  move_in_specials: string | null
  floor_plan_image_url: string | null
  floor_plan_image_alt: string | null
  availability_url: string | null
  apply_url: string | null
  source: string
  source_identity: string
  effective_at: string | null
  expires_at: string | null
  source_updated_at: string | null
}

function defined<T>(value: T | null): T | undefined {
  return value == null ? undefined : value
}

export function createApprovedFloorPlanSnapshot(
  units: readonly ApprovedPropertyUnit[],
  capturedAt = new Date().toISOString()
): ApprovedFloorPlanSnapshot {
  const rows = units
    .map((unit) => ({
      id: unit.canonical_key,
      name: unit.unit_type,
      bedrooms: unit.bedrooms,
      bathrooms: defined(unit.bathrooms),
      sqftMin: defined(unit.sqft_min),
      sqftMax: defined(unit.sqft_max),
      rentMin: defined(unit.rent_min),
      rentMax: defined(unit.rent_max),
      availableCount: defined(unit.available_count),
      specials: defined(unit.move_in_specials),
      imageUrl: defined(unit.floor_plan_image_url),
      imageAlt: defined(unit.floor_plan_image_alt),
      availabilityUrl: defined(unit.availability_url),
      applyUrl: defined(unit.apply_url),
      source: unit.source,
      sourceIdentity: unit.source_identity,
      effectiveAt: defined(unit.effective_at),
      expiresAt: defined(unit.expires_at),
      sourceUpdatedAt: defined(unit.source_updated_at),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const contentHash = hashSiteForgeContent(rows)

  return Object.freeze({
    capturedAt,
    contentHash,
    rows: Object.freeze(rows.map((row) => Object.freeze(row))),
  })
}
