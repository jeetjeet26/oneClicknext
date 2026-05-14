import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { badRequest, forbidden, serverError, unauthorized } from '@/utils/services/api-helpers'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  createSignedIntegrationOAuthState,
} from '@/utils/services/integration-oauth-state'
import {
  getMicrosoftAuthUrl,
  getProviderClientId,
  getProviderScopes,
  GOOGLE_AUTH_URL,
  normalizeCapabilities,
  normalizeProvider,
} from '@/utils/services/integration-provider-config'
import { getValidIntegrationAuthInviteByToken } from '@/utils/services/integration-auth-invites'
import { createRequestContext } from '@/utils/services/request-context'
import { getAppBaseUrl } from '@/utils/services/runtime-config'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const ctx = createRequestContext(request, '/api/lumaleasing/integrations/oauth/[provider]/start')
  ctx.logStart()

  try {
    const { provider: providerParam } = await params
    const provider = normalizeProvider(providerParam)
    if (!provider) {
      ctx.logSuccess(400, { reason: 'invalid_provider' })
      return badRequest('Provider must be google or microsoft', ctx.responseHeaders)
    }

    const clientId = getProviderClientId(provider)
    if (!clientId) {
      ctx.logError(500, new Error(`Missing ${provider} OAuth client ID`))
      return serverError(undefined, ctx.responseHeaders)
    }

    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')
    let propertyId = searchParams.get('propertyId')
    let profileId: string | undefined
    let inviteId: string | undefined
    let tokenHash: string | undefined
    let capabilities = normalizeCapabilities(searchParams.get('capabilities'))
    let authSource: 'dashboard' | 'external_invite' = 'dashboard'

    if (token) {
      const invite = await getValidIntegrationAuthInviteByToken(token)
      if (!invite || invite.provider !== provider) {
        ctx.logSuccess(400, { reason: 'invalid_or_expired_invite', provider })
        return badRequest('Integration invite is invalid or expired', ctx.responseHeaders)
      }
      propertyId = invite.property_id
      inviteId = invite.id
      tokenHash = invite.token_hash
      capabilities = invite.requested_capabilities
      authSource = 'external_invite'
    } else {
      if (!propertyId) {
        ctx.logSuccess(400, { reason: 'missing_property_id' })
        return badRequest('Property ID required', ctx.responseHeaders)
      }
      if (capabilities.length === 0) {
        capabilities = normalizeCapabilities(searchParams.get('capability') || 'calendar')
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
      profileId = user.id
    }

    if (!propertyId || capabilities.length === 0) {
      ctx.logSuccess(400, { reason: 'missing_oauth_context', provider })
      return badRequest('OAuth context is incomplete', ctx.responseHeaders)
    }

    const appUrl = getAppBaseUrl()
    const redirectUri = `${appUrl}/api/lumaleasing/integrations/oauth/${provider}/callback`
    const scopes = getProviderScopes(provider, capabilities)
    const state = createSignedIntegrationOAuthState({
      propertyId,
      provider,
      capabilities,
      authSource,
      profileId,
      inviteId,
      tokenHash,
    })

    const authUrl = new URL(provider === 'google' ? GOOGLE_AUTH_URL : getMicrosoftAuthUrl())
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', scopes.join(' '))
    authUrl.searchParams.set('state', state)

    if (provider === 'google') {
      authUrl.searchParams.set('access_type', 'offline')
      authUrl.searchParams.set('prompt', 'consent')
    } else {
      authUrl.searchParams.set('response_mode', 'query')
      authUrl.searchParams.set('prompt', 'select_account')
    }

    const response = NextResponse.redirect(authUrl.toString())
    Object.entries(ctx.responseHeaders).forEach(([key, value]) => {
      response.headers.set(key, value)
    })

    ctx.logSuccess(307, { propertyId, provider, capabilities, authSource })
    return response
  } catch (error) {
    ctx.logError(500, error, { operation: 'integration_oauth_start' })
    return serverError(error, ctx.responseHeaders)
  }
}
