/**
 * Gmail OAuth Callback
 * Handles redirect from Google after authorization
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { verifySignedGmailOAuthState } from '@/utils/services/gmail-oauth-state'
import { createRequestContext } from '@/utils/services/request-context'
import { getAppBaseUrl } from '@/utils/services/runtime-config'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const APP_URL = getAppBaseUrl()
const GOOGLE_REDIRECT_URI = `${APP_URL}/api/lumaleasing/email/callback`

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

function redirectWithHeaders(location: URL | string, headers: Record<string, string>) {
  const response = NextResponse.redirect(location)
  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value)
  })

  return response
}

function dashboardRedirect(
  headers: Record<string, string>,
  options?: {
    errorCode?: string
    params?: Record<string, string>
  }
) {
  const url = new URL('/dashboard/lumaleasing', APP_URL)

  if (options?.errorCode) {
    url.searchParams.set('error', options.errorCode)
  }

  Object.entries(options?.params || {}).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  return redirectWithHeaders(url, headers)
}

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/lumaleasing/email/callback')
  ctx.logStart()

  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    // Handle user denial
    if (error) {
      ctx.logSuccess(307, { reason: 'google_oauth_error', providerError: error })
      return dashboardRedirect(ctx.responseHeaders, { errorCode: 'email_denied' })
    }

    if (!code || !state) {
      ctx.logSuccess(307, { reason: 'missing_code_or_state' })
      return dashboardRedirect(ctx.responseHeaders, { errorCode: 'invalid_callback' })
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      ctx.logError(500, new Error('Missing Google OAuth credentials'))
      return dashboardRedirect(ctx.responseHeaders, { errorCode: 'email_not_configured' })
    }

    let propertyId: string
    let profileId: string

    try {
      const verifiedState = verifySignedGmailOAuthState(state)
      propertyId = verifiedState.propertyId
      profileId = verifiedState.profileId
    } catch (stateError) {
      const reason =
        stateError instanceof Error &&
        stateError.message === 'OAuth state has expired'
          ? 'expired_state'
          : 'invalid_state'

      ctx.logSuccess(307, { reason, error: stateError instanceof Error ? stateError.message : String(stateError) })
      return dashboardRedirect(ctx.responseHeaders, { errorCode: reason })
    }

    const supabase = createServiceClient()
    const [{ data: profile, error: profileError }, { data: property, error: propertyError }] =
      await Promise.all([
        supabase
          .from('profiles')
          .select('org_id')
          .eq('id', profileId)
          .single(),
        supabase
          .from('properties')
          .select('org_id')
          .eq('id', propertyId)
          .single(),
      ])

    if (
      profileError ||
      propertyError ||
      !profile?.org_id ||
      !property?.org_id ||
      profile.org_id !== property.org_id
    ) {
      ctx.logSuccess(307, { reason: 'state_access_invalid', propertyId, profileId })
      return dashboardRedirect(ctx.responseHeaders, { errorCode: 'state_access_invalid' })
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      ctx.logSuccess(307, {
        reason: 'token_exchange_failed',
        propertyId,
        profileId,
        providerStatus: tokenResponse.status,
      })
      console.error('[Gmail] Token exchange failed:', errorText)
      return dashboardRedirect(ctx.responseHeaders, { errorCode: 'token_exchange_failed' })
    }

    const tokens = await tokenResponse.json()
    const { access_token, refresh_token, expires_in } = tokens

    if (!access_token || !refresh_token || typeof expires_in !== 'number') {
      ctx.logSuccess(307, { reason: 'missing_tokens', propertyId, profileId })
      return dashboardRedirect(ctx.responseHeaders, { errorCode: 'missing_tokens' })
    }

    // Get user's email from Google userinfo API
    const userinfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    })

    if (!userinfoResponse.ok) {
      ctx.logSuccess(307, {
        reason: 'userinfo_failed',
        propertyId,
        profileId,
        providerStatus: userinfoResponse.status,
      })
      return dashboardRedirect(ctx.responseHeaders, { errorCode: 'userinfo_failed' })
    }

    const userinfo = await userinfoResponse.json()
    const googleEmail =
      typeof userinfo?.email === 'string' && userinfo.email.length > 0
        ? userinfo.email
        : null

    if (!googleEmail) {
      ctx.logSuccess(307, { reason: 'missing_google_email', propertyId, profileId })
      return dashboardRedirect(ctx.responseHeaders, { errorCode: 'userinfo_failed' })
    }

    // Calculate token expiration
    const tokenExpiresAt = new Date(Date.now() + expires_in * 1000).toISOString()

    // Check if email config already exists
    const { data: existing } = await supabase
      .from('email_configurations')
      .select('id')
      .eq('property_id', propertyId)
      .eq('profile_id', profileId)
      .maybeSingle()

    if (existing) {
      // Update existing config
      const { error: updateError } = await supabase
        .from('email_configurations')
        .update({
          provider: 'google',
          google_email: googleEmail,
          account_email: googleEmail,
          scopes: [
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.modify',
            'openid',
            'email',
          ],
          auth_source: 'dashboard',
          authorized_by_profile_id: profileId,
          access_token,
          refresh_token,
          token_expires_at: tokenExpiresAt,
          sync_enabled: true,
          token_status: 'healthy',
          last_health_check_at: new Date().toISOString(),
          health_check_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)

      if (updateError) {
        console.error('[Gmail] Failed to update email configuration:', updateError)
        ctx.logSuccess(307, { reason: 'database_error', propertyId, profileId, operation: 'update_email_config' })
        return dashboardRedirect(ctx.responseHeaders, { errorCode: 'database_error' })
      }
    } else {
      // Create new config
      const { error: insertError } = await supabase
        .from('email_configurations')
        .insert({
          profile_id: profileId,
          property_id: propertyId,
          provider: 'google',
          google_email: googleEmail,
          account_email: googleEmail,
          scopes: [
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.modify',
            'openid',
            'email',
          ],
          auth_source: 'dashboard',
          authorized_by_profile_id: profileId,
          access_token,
          refresh_token,
          token_expires_at: tokenExpiresAt,
          sync_enabled: true,
          token_status: 'healthy',
          last_health_check_at: new Date().toISOString(),
        })

      if (insertError) {
        console.error('[Gmail] Failed to create email configuration:', insertError)
        ctx.logSuccess(307, { reason: 'database_error', propertyId, profileId, operation: 'insert_email_config' })
        return dashboardRedirect(ctx.responseHeaders, { errorCode: 'database_error' })
      }
    }

    // Update lumaleasing_config to enable email
    const { error: configError } = await supabase
      .from('lumaleasing_config')
      .update({
        email_enabled: true,
        updated_at: new Date().toISOString(),
      })
      .eq('property_id', propertyId)

    if (configError) {
      console.error('[Gmail] Failed to update lumaleasing config:', configError)
      ctx.logSuccess(307, { reason: 'config_update_failed', propertyId, profileId })
      return dashboardRedirect(ctx.responseHeaders, { errorCode: 'config_update_failed' })
    }

    // Success! Redirect back to dashboard
    ctx.logSuccess(307, { propertyId, profileId, googleEmail, success: 'email_connected' })
    return dashboardRedirect(ctx.responseHeaders, {
      params: {
        success: 'email_connected',
        email: googleEmail,
      },
    })

  } catch (error) {
    ctx.logError(500, error, { operation: 'gmail_oauth_callback' })
    return dashboardRedirect(ctx.responseHeaders, { errorCode: 'callback_failed' })
  }
}
