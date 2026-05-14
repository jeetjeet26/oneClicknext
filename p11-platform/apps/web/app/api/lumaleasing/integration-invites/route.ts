import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { badRequest, forbidden, serverError, unauthorized } from '@/utils/services/api-helpers'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  createIntegrationAuthInvite,
  buildExternalIntegrationLink,
} from '@/utils/services/integration-auth-invites'
import {
  normalizeCapabilities,
  normalizeProvider,
} from '@/utils/services/integration-provider-config'
import { createRequestContext } from '@/utils/services/request-context'

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/lumaleasing/integration-invites')
  ctx.logStart()

  try {
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')
    if (!propertyId) {
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

    const serviceSupabase = createServiceClient()
    const { data, error } = await serviceSupabase
      .from('integration_auth_invites')
      .select('id, property_id, provider, requested_capabilities, token_preview, expires_at, consumed_at, revoked_at, created_at')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })
      .limit(25)

    if (error) {
      ctx.logError(500, error, { operation: 'list_integration_invites', propertyId })
      return serverError(error, ctx.responseHeaders)
    }

    ctx.logSuccess(200, { propertyId, count: data?.length || 0 })
    return NextResponse.json({ invites: data || [] }, { headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error, { operation: 'list_integration_invites' })
    return serverError(error, ctx.responseHeaders)
  }
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/lumaleasing/integration-invites')
  ctx.logStart()

  try {
    const body = await request.json().catch(() => ({}))
    const propertyId = typeof body.propertyId === 'string' ? body.propertyId : null
    const provider = normalizeProvider(body.provider)
    const capabilities = normalizeCapabilities(body.capabilities)

    if (!propertyId) {
      ctx.logSuccess(400, { reason: 'missing_property_id' })
      return badRequest('Property ID required', ctx.responseHeaders)
    }
    if (!provider) {
      ctx.logSuccess(400, { reason: 'invalid_provider' })
      return badRequest('Provider must be google or microsoft', ctx.responseHeaders)
    }
    if (capabilities.length === 0) {
      ctx.logSuccess(400, { reason: 'missing_capabilities' })
      return badRequest('At least one capability is required', ctx.responseHeaders)
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

    const result = await createIntegrationAuthInvite({
      propertyId,
      provider,
      capabilities,
      createdByProfileId: user.id,
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : undefined,
    })

    ctx.logSuccess(201, { propertyId, provider, capabilities })
    return NextResponse.json(
      {
        invite: result.invite,
        token: result.token,
        url: result.url,
      },
      { status: 201, headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'create_integration_invite' })
    return serverError(error, ctx.responseHeaders)
  }
}

export function inviteUrlFromToken(token: string) {
  return buildExternalIntegrationLink(token)
}
