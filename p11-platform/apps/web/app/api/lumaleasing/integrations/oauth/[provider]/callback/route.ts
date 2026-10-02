import { NextRequest, NextResponse } from 'next/server'
import {authorizationOperation,closeAuthorizationOutcome,type AuthorizationFailure,type AuthorizationResult} from '@/utils/services/integration-authorization'
import {
  verifySignedIntegrationOAuthState, INTEGRATION_STATE_TTL_MS, type IntegrationOAuthStatePayload,
} from '@/utils/services/integration-oauth-state'
import {
  getMicrosoftTokenUrl,
  getProviderClientId,
  getProviderClientSecret,
  GOOGLE_TOKEN_URL,
  MICROSOFT_GRAPH_API,
  normalizeProvider,
} from '@/utils/services/integration-provider-config'
import { createRequestContext } from '@/utils/services/request-context'
import { getAppBaseUrl } from '@/utils/services/runtime-config'
import { getCalendarConfig, ensureCalendarWatch } from '@/utils/services/google-calendar'
import { normalizeTimezoneToIana } from '@/utils/services/timezone'

import {confirmOAuthGrant, OAuthGrantError} from '@/utils/services/integration-oauth-grant'

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
}): Promise<unknown> {
  const clientId = getProviderClientId(params.provider)
  const clientSecret = getProviderClientSecret(params.provider)
  if (!clientId || !clientSecret) {
    throw new Error(`Missing ${params.provider} OAuth credentials`)
  }

  const tokenResponse = await fetch(
    params.provider === 'google' ? GOOGLE_TOKEN_URL : getMicrosoftTokenUrl(),
    {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
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
    throw new Error('provider_exchange_failed')
  }

  try { return await tokenResponse.json() } catch { throw new OAuthGrantError('invalid_token_response') }
}

async function fetchGoogleAccount(
  accessToken: string,
  capabilities: string[]
): Promise<ProviderAccount> {
  const userinfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000),
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
   try {
    const timezoneResponse = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/settings/timezone',
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) }
    )
    if (timezoneResponse.ok) {
      const timezoneData = await timezoneResponse.json()
      timezone = normalizeTimezoneToIana(
        typeof timezoneData?.value === 'string' ? timezoneData.value : null
      )
    }
   } catch { /* Keep missing timezone explicit for operator setup. */ }
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
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) }
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
  try {
  const settingsResponse = await fetch(`${MICROSOFT_GRAPH_API}/me/mailboxSettings`, {
    headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000),
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
      '[IntegrationOAuth] mailboxSettings unavailable; timezone setup may be required:',
      settingsResponse.status
    )
  }

  } catch { /* Keep missing timezone explicit for operator setup. */ }

  return {
    accountEmail,
    providerSubject: typeof me?.id === 'string' ? me.id : null,
    tenantId: null,
    timezone,
    metadata: { me },
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const ctx = createRequestContext(request, '/api/lumaleasing/integrations/oauth/[provider]/callback')
  ctx.logStart()
  let verified: IntegrationOAuthStatePayload | undefined
  let claimToken: string | undefined
  let stage: 'state' | 'claim' | 'exchange' | 'account' | 'save' = 'state'
  const redirectResult=(saved:AuthorizationResult)=>resultRedirect(ctx.responseHeaders, {
    success: verified!.capabilities.includes('calendar') ? (saved.timezoneSetupRequired ? 'calendar_setup_required' : 'calendar_connected') : 'email_connected',
    provider:verified!.provider,source:verified!.authSource,propertyId:verified!.propertyId,
  })
  const failure=(reason:string)=>resultRedirect(ctx.responseHeaders,{
    error:reason,source:verified?.authSource||'dashboard',...(verified?{propertyId:verified.propertyId}:{}),
  })
  const close=async(reason:AuthorizationFailure)=>{
    try {
      const outcome=await closeAuthorizationOutcome(verified!,reason,claimToken)
      return outcome.state==='replayed'?redirectResult(outcome):failure(String(outcome.state))
    } catch { return failure('authorization_outcome_unconfirmed') }
  }
  try {
    const { provider: providerParam } = await params
    const provider=normalizeProvider(providerParam)
    const {searchParams}=new URL(request.url)
    const state=searchParams.get('state')
    if(!provider||!state)return failure('invalid_callback')
    // Expired signed state may close its saved request. It can never exchange a code.
    const signed=verifySignedIntegrationOAuthState(state,Date.now(),{outcomeOnly:true})
    if(signed.provider!==provider)return failure('provider_mismatch')
    verified=signed
    if(Date.now()-verified.timestamp>INTEGRATION_STATE_TTL_MS)return close('expired_state')
    const providerError=searchParams.get('error')
    if(providerError)return close(providerError==='access_denied'?'authorization_denied':'provider_error')
    const code=searchParams.get('code')
    if(!code)return close('invalid_callback')

    stage='claim'
    const claim=await authorizationOperation('claim',verified)
    if(claim.state==='replayed')return redirectResult(claim)
    if(claim.state!=='claimed')return failure(String(claim.state))
    claimToken=claim.claimToken as string
    stage='exchange'
    const tokens=confirmOAuthGrant(provider,verified.capabilities,
      await exchangeCode({provider,code,redirectUri:verified.redirectUri!}),verified.requestedScopes)
    stage='account'
    const account=provider==='google'?await fetchGoogleAccount(tokens.access_token,verified.capabilities):await fetchMicrosoftAccount(tokens.access_token)
    if(!account.providerSubject)throw new Error('account_unconfirmed')
    stage='save'
    const saved=await authorizationOperation('finish',verified,{
      accessToken:tokens.access_token,refreshToken:tokens.refresh_token,
      expiresAt:new Date(Date.now()+tokens.expires_in*1000).toISOString(),
      accountEmail:account.accountEmail,subject:account.providerSubject,timezone:account.timezone,
      scopes:tokens.scopes,scopeEvidence:tokens.scopeEvidence,
    })
    if(!['saved','replayed'].includes(String(saved.state)))return failure(String(saved.state))
    if(provider==='google'&&saved.calendarId&&!saved.timezoneSetupRequired){
      try {const config=await getCalendarConfig(verified.propertyId);if(config)await ensureCalendarWatch(config)}
      catch {console.error('[IntegrationOAuth] Calendar watch setup needs attention')}
    }
    return redirectResult(saved)
  } catch(error) {
    const reason:AuthorizationFailure=error instanceof OAuthGrantError?error.code:
      stage==='account'?'account_unconfirmed':stage==='save'?'authorization_save_unconfirmed':
      stage==='exchange'&&error instanceof Error&&error.message==='provider_exchange_failed'?'provider_exchange_failed':
      stage==='state'?'invalid_callback':'authorization_unconfirmed'
    ctx.logError(307,new Error(reason),{operation:'integration_oauth_callback'})
    // Uncertain claims have no owner token: leave them for expiry, never re-exchange.
    return verified&&claimToken?close(reason):failure(reason)
  }
}
