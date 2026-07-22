import { NextRequest, NextResponse } from 'next/server'
import { getXCredentials } from '@/utils/forgestudio/social-config'
import {
  clearNonceCookie,
  connectionsRedirect,
  getSiteUrl,
  saveSocialConnection,
  validateForgeStudioOAuthCallback,
} from '@/utils/forgestudio/oauth-flow'

const X_PKCE_COOKIE = 'fs_x_pkce'

function clearPkceCookie(response: NextResponse): NextResponse {
  response.cookies.set(X_PKCE_COOKIE, '', {
    httpOnly: true,
    path: '/api/forgestudio/social/callback',
    maxAge: 0,
  })
  return response
}

// X (Twitter) OAuth 2.0 PKCE Callback — exchanges the code and saves the connection.
export async function GET(request: NextRequest) {
  try {
    const context = await validateForgeStudioOAuthCallback(request)
    if (context instanceof NextResponse) {
      return clearPkceCookie(context)
    }
    const { propertyId, userId, code } = context

    const codeVerifier = request.cookies.get(X_PKCE_COOKIE)?.value
    if (!codeVerifier) {
      return clearPkceCookie(
        clearNonceCookie(connectionsRedirect({ error: 'missing_pkce_verifier' }))
      )
    }

    const credentials = await getXCredentials(propertyId)
    if (!credentials) {
      return clearPkceCookie(
        clearNonceCookie(connectionsRedirect({ error: 'missing_config', setup_required: 'x' }))
      )
    }

    const redirectUri = `${getSiteUrl()}/api/forgestudio/social/callback/x`

    // Step 1: Exchange code for tokens (confidential client → Basic auth).
    const basic = Buffer.from(`${credentials.appId}:${credentials.appSecret}`).toString('base64')
    const tokenRes = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        client_id: credentials.appId,
      }),
    })

    const tokenData = await tokenRes.json().catch(() => ({}))
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('X token exchange error:', tokenData)
      return clearPkceCookie(
        clearNonceCookie(
          connectionsRedirect({ error: tokenData.error_description || 'token_exchange_failed' })
        )
      )
    }

    const accessToken: string = tokenData.access_token
    const refreshToken: string | null = tokenData.refresh_token ?? null
    const expiresIn: number = tokenData.expires_in || 7200

    // Step 2: Fetch the authenticated user.
    const profileRes = await fetch(
      'https://api.x.com/2/users/me?user.fields=profile_image_url,username,name',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const profileData = await profileRes.json().catch(() => ({}))
    const xUser = profileData.data
    if (!profileRes.ok || !xUser?.id) {
      console.error('X profile fetch failed:', profileData)
      return clearPkceCookie(
        clearNonceCookie(connectionsRedirect({ error: 'Failed to fetch X profile' }))
      )
    }

    // Step 3: Save connection (tokens encrypted at rest).
    try {
      await saveSocialConnection({
        propertyId,
        userId,
        platform: 'x',
        accountId: xUser.id,
        accountName: xUser.name ?? null,
        accountUsername: xUser.username ?? null,
        accountAvatarUrl: xUser.profile_image_url ?? null,
        accessToken,
        refreshToken,
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
        scopes: (tokenData.scope || '').split(' ').filter(Boolean),
        rawProfile: xUser,
      })
    } catch (saveError) {
      console.error('Error saving X connection:', saveError)
      return clearPkceCookie(clearNonceCookie(connectionsRedirect({ error: 'save_failed' })))
    }

    return clearPkceCookie(
      clearNonceCookie(
        connectionsRedirect({ connected: 'x', account: xUser.username || xUser.name || '' })
      )
    )
  } catch (error) {
    console.error('X callback error:', error)
    return clearPkceCookie(clearNonceCookie(connectionsRedirect({ error: 'Connection failed' })))
  }
}
