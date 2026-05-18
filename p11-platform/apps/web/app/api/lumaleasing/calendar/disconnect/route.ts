import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { badRequest, forbidden, serverError, unauthorized } from '@/utils/services/api-helpers'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/lumaleasing/calendar/disconnect')
  ctx.logStart()

  try {
    const { propertyId, provider } = await request.json().catch(() => ({}))
    if (typeof propertyId !== 'string' || propertyId.length === 0) {
      ctx.logSuccess(400, { reason: 'missing_property_id' })
      return badRequest('Property ID required', ctx.responseHeaders)
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', propertyId, userId: user.id })
      return forbidden(ctx.responseHeaders)
    }

    const admin = createServiceClient()
    const updatePayload = {
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
      sync_enabled: false,
      token_status: 'disconnected',
      health_check_error: 'Disconnected by operator',
      watch_channel_id: null,
      watch_resource_id: null,
      watch_expiration: null,
      watch_last_message_number: null,
      updated_at: new Date().toISOString(),
    }

    let query = admin
      .from('agent_calendars')
      .update(updatePayload)
      .eq('property_id', propertyId)

    if (provider === 'google' || provider === 'microsoft') {
      query = query.eq('provider', provider)
    }

    const { data, error } = await query.select('id')
    if (error) {
      ctx.logError(500, error, { operation: 'disconnect_calendar', propertyId })
      return serverError(error, ctx.responseHeaders)
    }

    ctx.logSuccess(200, {
      propertyId,
      provider: provider || 'any',
      disconnected: data?.length || 0,
    })
    return NextResponse.json(
      { success: true, disconnected: data?.length || 0 },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'disconnect_calendar' })
    return serverError(error, ctx.responseHeaders)
  }
}
