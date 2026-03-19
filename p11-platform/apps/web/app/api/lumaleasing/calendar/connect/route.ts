/**
 * Google Calendar OAuth Initiation
 * Redirects property manager to Google consent screen
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { badRequest, forbidden, serverError, unauthorized } from '@/utils/services/api-helpers'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createSignedGoogleOAuthState } from '@/utils/services/google-oauth-state'
import { createRequestContext } from '@/utils/services/request-context'
import { getAppBaseUrl } from '@/utils/services/runtime-config'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_REDIRECT_URI = `${getAppBaseUrl()}/api/lumaleasing/calendar/callback`

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ')

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/lumaleasing/calendar/connect')
  ctx.logStart()

  try {
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      ctx.logSuccess(400, { reason: 'missing_property_id' })
      return badRequest('Property ID required', ctx.responseHeaders)
    }

    if (!GOOGLE_CLIENT_ID) {
      ctx.logError(500, new Error('Missing GOOGLE_CLIENT_ID'))
      return serverError(undefined, ctx.responseHeaders)
    }

    // Verify user has access to this property
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    // Build OAuth URL with state parameter
    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', propertyId, userId: user.id })
      return forbidden(ctx.responseHeaders)
    }

    const state = createSignedGoogleOAuthState({
      propertyId,
      profileId: user.id,
    })

    const authUrl = new URL(GOOGLE_AUTH_URL)
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID)
    authUrl.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', SCOPES)
    authUrl.searchParams.set('access_type', 'offline') // Get refresh token
    authUrl.searchParams.set('prompt', 'consent') // Force consent to get refresh token
    authUrl.searchParams.set('state', state)

    // Redirect to Google OAuth consent screen
    const response = NextResponse.redirect(authUrl.toString())
    Object.entries(ctx.responseHeaders).forEach(([key, value]) => {
      response.headers.set(key, value)
    })

    ctx.logSuccess(307, { propertyId, userId: user.id })
    return response

  } catch (error) {
    ctx.logError(500, error, { operation: 'google_calendar_oauth_initiation' })
    return serverError(error, ctx.responseHeaders)
  }
}
