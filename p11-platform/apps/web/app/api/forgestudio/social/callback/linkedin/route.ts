import { NextRequest, NextResponse } from 'next/server'
import { getLinkedInCredentials } from '@/utils/forgestudio/social-config'
import {
  clearNonceCookie,
  connectionsRedirect,
  getSiteUrl,
  saveSocialConnection,
  validateForgeStudioOAuthCallback,
} from '@/utils/forgestudio/oauth-flow'

// LinkedIn OAuth Callback
// Exchanges the code for tokens and saves the connection.
export async function GET(request: NextRequest) {
  try {
    const context = await validateForgeStudioOAuthCallback(request)
    if (context instanceof NextResponse) {
      return context
    }
    const { propertyId, userId, code } = context

    const credentials = await getLinkedInCredentials(propertyId)
    const redirectUri = `${getSiteUrl()}/api/forgestudio/social/callback/linkedin`

    if (!credentials) {
      return clearNonceCookie(
        connectionsRedirect({ error: 'missing_config', setup_required: 'linkedin' })
      )
    }

    // Step 1: Exchange code for access token
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: credentials.appId,
        client_secret: credentials.appSecret,
      }),
    })

    const tokenData = await tokenRes.json()

    if (tokenData.error) {
      console.error('LinkedIn token exchange error:', tokenData)
      return clearNonceCookie(
        connectionsRedirect({ error: tokenData.error_description || tokenData.error })
      )
    }

    const accessToken = tokenData.access_token
    const refreshToken = typeof tokenData.refresh_token === 'string' ? tokenData.refresh_token : null
    const expiresIn = tokenData.expires_in || 5184000 // 60 days default

    // Step 2: Get user profile
    const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!profileRes.ok) {
      console.error('LinkedIn profile fetch failed:', await profileRes.text())
      return clearNonceCookie(
        connectionsRedirect({ error: 'Failed to fetch LinkedIn profile' })
      )
    }

    const profile = await profileRes.json()

    // Step 3: Save connection (tokens encrypted at rest)
    try {
      await saveSocialConnection({
        propertyId,
        userId,
        platform: 'linkedin',
        accountId: profile.sub,
        accountName: profile.name,
        accountUsername: profile.email,
        accountAvatarUrl: profile.picture,
        accessToken,
        refreshToken,
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
        scopes: ['openid', 'profile', 'w_member_social'],
        rawProfile: profile,
      })
    } catch (saveError) {
      console.error('Error saving LinkedIn connection:', saveError)
      return clearNonceCookie(connectionsRedirect({ error: 'save_failed' }))
    }

    return clearNonceCookie(
      connectionsRedirect({ connected: 'linkedin', account: profile.name || '' })
    )
  } catch (error) {
    console.error('LinkedIn callback error:', error)
    return clearNonceCookie(connectionsRedirect({ error: 'Connection failed' }))
  }
}
