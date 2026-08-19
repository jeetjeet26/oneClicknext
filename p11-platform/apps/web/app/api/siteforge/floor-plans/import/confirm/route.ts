import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { confirmFloorPlanImport } from '@/utils/siteforge/providers/floor-plan-repository'
import {
  archiveMissingPropertyConsoleFloorPlans,
  PROPERTY_CONSOLE_SOURCE_IDENTITY,
} from '@/utils/siteforge/providers/manual-floor-plan-workflow'

const requestSchema = z.object({
  propertyId: z.guid(),
  importId: z.string().uuid(),
})

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/floor-plans/import/confirm'
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
      return NextResponse.json(
        { error: 'Invalid floor-plan confirmation request' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const access = await validatePropertyAccess(user.id, parsed.data.propertyId)
    if (!access.authorized || !access.orgId) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }

    const service = createServiceClient()
    const { data: importRecord, error: importError } = await service
      .from('property_unit_imports')
      .select('id, org_id, property_id, status, error_count, source_type, source_identity')
      .eq('id', parsed.data.importId)
      .eq('property_id', parsed.data.propertyId)
      .eq('org_id', access.orgId)
      .single()
    if (importError || !importRecord) {
      return NextResponse.json(
        { error: 'Floor-plan import not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    if (importRecord.error_count > 0) {
      return NextResponse.json(
        { error: 'Resolve preview errors before confirming this import' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    if (!['preview', 'applied'].includes(importRecord.status)) {
      return NextResponse.json(
        { error: 'Floor-plan import is not confirmable' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const result = await confirmFloorPlanImport(importRecord.id, user.id, service)
    if (
      importRecord.source_type === 'manual' &&
      importRecord.source_identity === PROPERTY_CONSOLE_SOURCE_IDENTITY
    ) {
      await archiveMissingPropertyConsoleFloorPlans(
        {
          propertyId: parsed.data.propertyId,
          importId: importRecord.id,
          orgId: access.orgId,
        },
        service
      )
    }
    ctx.logSuccess(200, {
      importId: importRecord.id,
      applied: result.applied,
    })
    return NextResponse.json(
      { success: true, importId: importRecord.id, ...result },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to confirm floor-plan import' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
