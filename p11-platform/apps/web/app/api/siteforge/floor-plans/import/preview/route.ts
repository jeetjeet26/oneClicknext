import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  CsvFloorPlanAdapter,
  ManualFloorPlanAdapter,
  createFloorPlanPreview,
} from '@/utils/siteforge/providers/floor-plans'
import { createFloorPlanImportPreview } from '@/utils/siteforge/providers/floor-plan-repository'

const requestSchema = z.discriminatedUnion('sourceType', [
  z.object({
    propertyId: z.guid(),
    sourceType: z.literal('manual'),
    sourceIdentity: z.string().trim().min(1).max(200).default('manual'),
    rows: z.array(z.unknown()).max(2_000),
  }),
  z.object({
    propertyId: z.guid(),
    sourceType: z.literal('csv'),
    sourceIdentity: z.string().trim().min(1).max(200).default('csv-upload'),
    filename: z.string().trim().min(1).max(255),
    csv: z.string().min(1).max(5_000_000),
  }),
])

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/floor-plans/import/preview'
  )
  ctx.logStart()
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: ctx.responseHeaders }
      )
    }

    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      ctx.logSuccess(400, { reason: 'invalid_request' })
      return NextResponse.json(
        { error: 'Invalid floor-plan import request' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const access = await validatePropertyAccess(user.id, parsed.data.propertyId)
    if (!access.authorized || !access.orgId) {
      ctx.logSuccess(403, { reason: 'forbidden' })
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }

    const service = createServiceClient()
    const { data: property, error: propertyError } = await service
      .from('properties')
      .select('id, org_id')
      .eq('id', parsed.data.propertyId)
      .eq('org_id', access.orgId)
      .single()
    if (propertyError || !property?.org_id) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }

    const preview =
      parsed.data.sourceType === 'csv'
        ? createFloorPlanPreview(new CsvFloorPlanAdapter(), parsed.data.csv)
        : createFloorPlanPreview(new ManualFloorPlanAdapter(), parsed.data.rows)
    const record = await createFloorPlanImportPreview(
      {
        orgId: property.org_id,
        propertyId: property.id,
        userId: user.id,
        sourceType: parsed.data.sourceType,
        sourceIdentity: parsed.data.sourceIdentity,
        originalFilename:
          parsed.data.sourceType === 'csv' ? parsed.data.filename : undefined,
        preview,
      },
      service
    )

    ctx.logSuccess(200, {
      importId: record.id,
      rows: preview.rows.length,
      errors: preview.errors.length,
    })
    return NextResponse.json(
      {
        importId: record.id,
        status: record.status,
        rows: preview.rows,
        errors: preview.errors,
        canConfirm:
          preview.errors.length === 0 &&
          (preview.rows.length > 0 ||
            (parsed.data.sourceType === 'manual' &&
              parsed.data.sourceIdentity === 'property-console')),
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to preview floor-plan import' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
