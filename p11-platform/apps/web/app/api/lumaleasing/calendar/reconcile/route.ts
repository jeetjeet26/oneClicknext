import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import {
  badRequest,
  forbidden,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  CalendarReconcileError,
  reconcileCalendarForProperty,
} from '@/utils/services/lumaleasing-calendar-reconcile'

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/lumaleasing/calendar/reconcile')
  ctx.logStart()

  try {
    const { searchParams } = new URL(request.url)
    const body =
      request.headers.get('content-type')?.includes('application/json')
        ? await request.json().catch(() => ({}))
        : {}
    const propertyId =
      searchParams.get('propertyId') ||
      (typeof body?.propertyId === 'string' ? body.propertyId : null)

    if (!propertyId) {
      ctx.logSuccess(400, { reason: 'missing_property_id' })
      return badRequest('Property ID required', ctx.responseHeaders)
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', propertyId, userId: user.id })
      return forbidden(ctx.responseHeaders)
    }

    const result = await reconcileCalendarForProperty(propertyId)

    ctx.logSuccess(200, {
      propertyId,
      bookingCount: result.activeBookings,
      created: result.created,
      repaired: result.repaired,
      alreadySynced: result.alreadySynced,
      skipped: result.skipped,
      failed: result.failed,
    })

    return NextResponse.json(
      {
        success: true,
        ...result,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    if (error instanceof CalendarReconcileError) {
      ctx.logSuccess(400, { reason: error.code })
      return badRequest(error.message, ctx.responseHeaders)
    }
    ctx.logError(500, error, { operation: 'calendar_reconcile' })
    return serverError(error, ctx.responseHeaders)
  }
}
