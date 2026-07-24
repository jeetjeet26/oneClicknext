import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  verifySignedIntegrationOAuthState,
} from '@/utils/services/integration-oauth-state'
import {
  getMicrosoftTokenUrl,
  getProviderClientId,
  getProviderClientSecret,
  getProviderScopes,
  GOOGLE_TOKEN_URL,
  MICROSOFT_GRAPH_API,
  normalizeProvider,
} from '@/utils/services/integration-provider-config'
import { createRequestContext } from '@/utils/services/request-context'
import { getAppBaseUrl } from '@/utils/services/runtime-config'
import { getCalendarConfig, ensureCalendarWatch } from '@/utils/services/google-calendar'
import { normalizeTimezoneToIana } from '@/utils/services/timezone'

type ProviderTokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

type ProviderAccount = {
  accountEmail: string
  providerSubject: string | null
  tenantId: string | null
  timezone: string | null
  metadata: Record<string, unknown>
}

function redirectWithHeaders(location: URL | string, headers: Record<string, string>) {
  const response = NextResponse.redirect(location)
  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value)
  })
  return response
}

function resultRedirect(
  headers: Record<string, string>,
  params: Record<string, string>
) {
  const appUrl = getAppBaseUrl()
  const pathname = params.source === 'external_invite'
    ? '/lumaleasing/integrations/success'
    : '/dashboard/lumaleasing'
  const url = new URL(pathname, appUrl)
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })
  return redirectWithHeaders(url, headers)
}

async function exchangeCode(params: {
  provider: 'google' | 'microsoft'
  code: string
  redirectUri: string
}): Promise<ProviderTokenResponse> {
  const clientId = getProviderClientId(params.provider)
  const clientSecret = getProviderClientSecret(params.provider)
  if (!clientId || !clientSecret) {
    throw new Error(`Missing ${params.provider} OAuth credentials`)
  }

  const tokenResponse = await fetch(
    params.provider === 'google' ? GOOGLE_TOKEN_URL : getMicrosoftTokenUrl(),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: params.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: params.redirectUri,
        grant_type: 'authorization_code',
      }),
    }
  )

  if (!tokenResponse.ok) {
    throw new Error(`Token exchange failed: ${tokenResponse.status}`)
  }

  return tokenResponse.json()
}

async function fetchGoogleAccount(
  accessToken: string,
  capabilities: string[]
): Promise<ProviderAccount> {
  const userinfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!userinfoResponse.ok) {
    throw new Error(`Google userinfo failed: ${userinfoResponse.status}`)
  }

  const userinfo = await userinfoResponse.json()
  const accountEmail =
    typeof userinfo?.email === 'string' && userinfo.email.length > 0
      ? userinfo.email
      : null
  if (!accountEmail) {
    throw new Error('Google account email missing')
  }

  let timezone: string | null = null
  if (capabilities.includes('calendar')) {
    const timezoneResponse = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/settings/timezone',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (timezoneResponse.ok) {
      const timezoneData = await timezoneResponse.json()
      timezone = normalizeTimezoneToIana(
        typeof timezoneData?.value === 'string' ? timezoneData.value : null
      )
    }
  }

  return {
    accountEmail,
    providerSubject: typeof userinfo?.id === 'string' ? userinfo.id : null,
    tenantId: null,
    timezone,
    metadata: { userinfo },
  }
}

async function fetchMicrosoftAccount(accessToken: string): Promise<ProviderAccount> {
  const meResponse = await fetch(
    `${MICROSOFT_GRAPH_API}/me?$select=id,mail,userPrincipalName,displayName`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!meResponse.ok) {
    throw new Error(`Microsoft userinfo failed: ${meResponse.status}`)
  }
  const me = await meResponse.json()
  const accountEmail =
    typeof me?.mail === 'string' && me.mail.length > 0
      ? me.mail
      : typeof me?.userPrincipalName === 'string'
        ? me.userPrincipalName
        : null
  if (!accountEmail) {
    throw new Error('Microsoft account email missing')
  }

  let timezone: string | null = null
  const settingsResponse = await fetch(`${MICROSOFT_GRAPH_API}/me/mailboxSettings`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (settingsResponse.ok) {
    const settings = await settingsResponse.json()
    // Graph returns Windows timezone names (e.g. "Pacific Standard Time");
    // normalize to IANA so slot generation can use it.
    timezone = normalizeTimezoneToIana(
      typeof settings?.timeZone === 'string' ? settings.timeZone : null
    )
  } else {
    console.error(
      '[IntegrationOAuth] mailboxSettings fetch failed; falling back to default timezone:',
      settingsResponse.status
    )
  }

  return {
    accountEmail,
    providerSubject: typeof me?.id === 'string' ? me.id : null,
    tenantId: null,
    timezone,
    metadata: { me },
  }
}

async function assertDashboardAccess(profileId: string, propertyId: string) {
  const supabase = createServiceClient()
  const [{ data: profile }, { data: property }] = await Promise.all([
    supabase.from('profiles').select('org_id').eq('id', profileId).single(),
    supabase.from('properties').select('org_id').eq('id', propertyId).single(),
  ])

  return Boolean(profile?.org_id && property?.org_id && profile.org_id === property.org_id)
}

async function storeCalendarConnection(params: {
  propertyId: string
  profileId: string | null
  provider: 'google' | 'microsoft'
  account: ProviderAccount
  tokens: Required<Pick<ProviderTokenResponse, 'access_token' | 'refresh_token' | 'expires_in'>>
  scopes: string[]
  authSource: 'dashboard' | 'external_invite'
  inviteId?: string
}) {
  const supabase = createServiceClient()
  const tokenExpiresAt = new Date(Date.now() + params.tokens.expires_in * 1000).toISOString()
  const payload = {
    profile_id: params.profileId,
    property_id: params.propertyId,
    provider: params.provider,
    google_email: params.account.accountEmail,
    account_email: params.account.accountEmail,
    provider_subject: params.account.providerSubject,
    tenant_id: params.account.tenantId,
    scopes: params.scopes,
    auth_source: params.authSource,
    authorized_by_profile_id: params.profileId,
    external_invite_id: params.inviteId || null,
    access_token: params.tokens.access_token,
    refresh_token: params.tokens.refresh_token,
    token_expires_at: tokenExpiresAt,
    timezone: params.account.timezone || 'America/Chicago',
    sync_enabled: true,
    token_status: 'healthy',
    last_health_check_at: new Date().toISOString(),
    health_check_error: null,
    provider_metadata: JSON.parse(JSON.stringify(params.account.metadata)),
    updated_at: new Date().toISOString(),
  }

  const { data: existing } = await supabase
    .from('agent_calendars')
    .select('id')
    .eq('property_id', params.propertyId)
    .eq('provider', params.provider)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase.from('agent_calendars').update(payload).eq('id', existing.id)
    if (error) throw error
    return existing.id
  }

  const { data, error } = await supabase
    .from('agent_calendars')
    .insert(payload)
    .select('id')
    .single()
  if (error || !data) throw error || new Error('Failed to store calendar connection')
  return data.id
}

async function storeEmailConnection(params: {
  propertyId: string
  profileId: string | null
  provider: 'google' | 'microsoft'
  account: ProviderAccount
  tokens: Required<Pick<ProviderTokenResponse, 'access_token' | 'refresh_token' | 'expires_in'>>
  scopes: string[]
  authSource: 'dashboard' | 'external_invite'
  inviteId?: string
}) {
  const supabase = createServiceClient()
  const tokenExpiresAt = new Date(Date.now() + params.tokens.expires_in * 1000).toISOString()
  const payload = {
    profile_id: params.profileId,
    property_id: params.propertyId,
    provider: params.provider,
    google_email: params.account.accountEmail,
    account_email: params.account.accountEmail,
    provider_subject: params.account.providerSubject,
    tenant_id: params.account.tenantId,
    scopes: params.scopes,
    auth_source: params.authSource,
    authorized_by_profile_id: params.profileId,
    external_invite_id: params.inviteId || null,
    access_token: params.tokens.access_token,
    refresh_token: params.tokens.refresh_token,
    token_expires_at: tokenExpiresAt,
    sync_enabled: true,
    token_status: 'healthy',
    last_health_check_at: new Date().toISOString(),
    health_check_error: null,
    provider_metadata: JSON.parse(JSON.stringify(params.account.metadata)),
    updated_at: new Date().toISOString(),
  }

  const { data: existing } = await supabase
    .from('email_configurations')
    .select('id')
    .eq('property_id', params.propertyId)
    .eq('provider', params.provider)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase.from('email_configurations').update(payload).eq('id', existing.id)
    if (error) throw error
    return existing.id
  }

  const { data, error } = await supabase
    .from('email_configurations')
    .insert(payload)
    .select('id')
    .single()
  if (error || !data) throw error || new Error('Failed to store email connection')

  await supabase
    .from('lumaleasing_config')
    .update({ email_enabled: true, email_configuration_id: data.id, updated_at: new Date().toISOString() })
    .eq('property_id', params.propertyId)

  return data.id
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const ctx = createRequestContext(request, '/api/lumaleasing/integrations/oauth/[provider]/callback')
  ctx.logStart()

  try {
    const { provider: providerParam } = await params
    const provider = normalizeProvider(providerParam)
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const providerError = searchParams.get('error')

    if (!provider || providerError || !code || !state) {
      ctx.logSuccess(307, { reason: providerError || 'invalid_callback', provider })
      return resultRedirect(ctx.responseHeaders, {
        error: providerError || 'invalid_callback',
        source: 'dashboard',
      })
    }

    const verifiedState = verifySignedIntegrationOAuthState(state)
    if (verifiedState.provider !== provider) {
      ctx.logSuccess(307, { reason: 'provider_mismatch', provider })
      return resultRedirect(ctx.responseHeaders, {
        error: 'provider_mismatch',
        source: verifiedState.authSource,
      })
    }

    if (verifiedState.authSource === 'dashboard') {
      if (!verifiedState.profileId || !(await assertDashboardAccess(verifiedState.profileId, verifiedState.propertyId))) {
        ctx.logSuccess(307, { reason: 'state_access_invalid', propertyId: verifiedState.propertyId })
        return resultRedirect(ctx.responseHeaders, {
          error: 'state_access_invalid',
          source: 'dashboard',
        })
      }
    }

    const requestOrigin = new URL(request.url).origin
    const redirectUri = `${requestOrigin}/api/lumaleasing/integrations/oauth/${provider}/callback`
    const tokens = await exchangeCode({ provider, code, redirectUri })
    if (!tokens.access_token || !tokens.refresh_token || typeof tokens.expires_in !== 'number') {
      throw new Error('OAuth token response missing required tokens')
    }

    const scopes = tokens.scope?.split(' ').filter(Boolean) ||
      getProviderScopes(provider, verifiedState.capabilities)
    const account = provider === 'google'
      ? await fetchGoogleAccount(tokens.access_token, verifiedState.capabilities)
      : await fetchMicrosoftAccount(tokens.access_token)

    let calendarId: string | null = null
    let emailConfigId: string | null = null
    const profileId = verifiedState.profileId || null
    const common = {
      propertyId: verifiedState.propertyId,
      profileId,
      provider,
      account,
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
      },
      scopes,
      authSource: verifiedState.authSource,
      inviteId: verifiedState.inviteId,
    }

    if (verifiedState.capabilities.includes('calendar')) {
      calendarId = await storeCalendarConnection(common)
      if (provider === 'google') {
        try {
          const calendarConfig = await getCalendarConfig(verifiedState.propertyId)
          if (calendarConfig) await ensureCalendarWatch(calendarConfig)
        } catch (watchError) {
          console.error('[IntegrationOAuth] Calendar watch setup failed:', watchError)
        }
      }
    }

    if (verifiedState.capabilities.includes('email')) {
      emailConfigId = await storeEmailConnection(common)
    }

    if (verifiedState.inviteId) {
      const supabase = createServiceClient()
      await supabase
        .from('integration_auth_invites')
        .update({
          consumed_at: new Date().toISOString(),
          consumed_calendar_id: calendarId,
          consumed_email_configuration_id: emailConfigId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', verifiedState.inviteId)
        .eq('token_hash', verifiedState.tokenHash || '')
    }

    ctx.logSuccess(307, {
      propertyId: verifiedState.propertyId,
      provider,
      capabilities: verifiedState.capabilities,
      accountEmail: account.accountEmail,
    })

    return resultRedirect(ctx.responseHeaders, {
      success: verifiedState.capabilities.includes('calendar') ? 'calendar_connected' : 'email_connected',
      provider,
      email: account.accountEmail,
      source: verifiedState.authSource,
    })
  } catch (error) {
    ctx.logError(307, error, { operation: 'integration_oauth_callback' })
    return resultRedirect(ctx.responseHeaders, {
      error: error instanceof Error && error.message === 'OAuth state has expired'
        ? 'expired_state'
        : 'callback_failed',
      source: 'dashboard',
    })
  }
}
