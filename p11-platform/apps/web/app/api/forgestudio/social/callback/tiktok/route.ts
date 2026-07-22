import { NextRequest, NextResponse } from 'next/server'
import { getTikTokCredentials } from '@/utils/forgestudio/social-config'
import {
  clearNonceCookie,
  connectionsRedirect,
  getSiteUrl,
  saveSocialConnection,
  validateForgeStudioOAuthCallback,
} from '@/utils/forgestudio/oauth-flow'

// TikTok OAuth Callback — exchanges the code for tokens and saves the connection.
export async function GET(request: NextRequest) {
  try {
    const context = await validateForgeStudioOAuthCallback(request)
    if (context instanceof NextResponse) {
      return context
    }
    const { propertyId, userId, code } = context

    const credentials = await getTikTokCredentials(propertyId)
    if (!credentials) {
      return clearNonceCookie(
        connectionsRedirect({ error: 'missing_config', setup_required: 'tiktok' })
      )
    }

    const redirectUri = `${getSiteUrl()}/api/forgestudio/social/callback/tiktok`

    // Step 1: Exchange code for tokens.
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: credentials.appId,
        client_secret: credentials.appSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    })

    const tokenData = await tokenRes.json().catch(() => ({}))
    if (!tokenRes.ok || tokenData.error || !tokenData.access_token) {
      console.error('TikTok token exchange error:', tokenData)
      return clearNonceCookie(
        connectionsRedirect({ error: tokenData.error_description || 'token_exchange_failed' })
      )
    }

    const accessToken: string = tokenData.access_token
    const refreshToken: string | null = tokenData.refresh_token ?? null
    const expiresIn: number = tokenData.expires_in || 86400
    const openId: string = tokenData.open_id

    // Step 2: Fetch creator profile.
    let displayName: string | null = null
    let avatarUrl: string | null = null
    let username: string | null = null
    try {
      const profileRes = await fetch(
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,username',
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const profileData = await profileRes.json().catch(() => ({}))
      displayName = profileData.data?.user?.display_name ?? null
      avatarUrl = profileData.data?.user?.avatar_url ?? null
      username = profileData.data?.user?.username ?? null
    } catch {
      // Profile fetch is best-effort; the connection still works.
    }

    // Step 3: Save connection (tokens encrypted at rest).
    try {
      await saveSocialConnection({
        propertyId,
        userId,
        platform: 'tiktok',
        accountId: openId,
        accountName: displayName,
        accountUsername: username,
        accountAvatarUrl: avatarUrl,
        accessToken,
        refreshToken,
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
        scopes: (tokenData.scope || '').split(',').filter(Boolean),
      })
    } catch (saveError) {
      console.error('Error saving TikTok connection:', saveError)
      return clearNonceCookie(connectionsRedirect({ error: 'save_failed' }))
    }

    return clearNonceCookie(
      connectionsRedirect({ connected: 'tiktok', account: displayName || '' })
    )
  } catch (error) {
    console.error('TikTok callback error:', error)
    return clearNonceCookie(connectionsRedirect({ error: 'Connection failed' }))
  }
}
