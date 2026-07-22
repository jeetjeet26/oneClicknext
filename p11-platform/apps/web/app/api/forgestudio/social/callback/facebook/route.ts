import { NextRequest, NextResponse } from 'next/server'
import { getMetaCredentials } from '@/utils/forgestudio/social-config'
import {
  clearNonceCookie,
  connectionsRedirect,
  getSiteUrl,
  saveSocialConnection,
  validateForgeStudioOAuthCallback,
} from '@/utils/forgestudio/oauth-flow'

// Facebook OAuth Callback
// Exchanges the code for tokens and saves each managed Page as a connection.
export async function GET(request: NextRequest) {
  try {
    const context = await validateForgeStudioOAuthCallback(request)
    if (context instanceof NextResponse) {
      return context
    }
    const { propertyId, userId, code } = context

    const credentials = await getMetaCredentials(propertyId)
    const redirectUri = `${getSiteUrl()}/api/forgestudio/social/callback/facebook`

    if (!credentials) {
      return clearNonceCookie(
        connectionsRedirect({ error: 'missing_config', setup_required: 'facebook' })
      )
    }

    const { appId: clientId, appSecret: clientSecret } = credentials

    // Step 1: Exchange code for short-lived access token
    const tokenUrl = new URL('https://graph.facebook.com/v21.0/oauth/access_token')
    tokenUrl.searchParams.set('client_id', clientId)
    tokenUrl.searchParams.set('client_secret', clientSecret)
    tokenUrl.searchParams.set('redirect_uri', redirectUri)
    tokenUrl.searchParams.set('code', code)

    const tokenRes = await fetch(tokenUrl.toString())
    const tokenData = await tokenRes.json()

    if (tokenData.error) {
      console.error('Token exchange error:', tokenData.error)
      return clearNonceCookie(
        connectionsRedirect({ error: tokenData.error.message || 'Token exchange failed' })
      )
    }

    const shortLivedToken = tokenData.access_token

    // Step 2: Exchange for long-lived token (60 days)
    const longLivedUrl = new URL('https://graph.facebook.com/v21.0/oauth/access_token')
    longLivedUrl.searchParams.set('grant_type', 'fb_exchange_token')
    longLivedUrl.searchParams.set('client_id', clientId)
    longLivedUrl.searchParams.set('client_secret', clientSecret)
    longLivedUrl.searchParams.set('fb_exchange_token', shortLivedToken)

    const longLivedRes = await fetch(longLivedUrl.toString())
    const longLivedData = await longLivedRes.json()

    const accessToken = longLivedData.access_token || shortLivedToken
    const expiresIn = longLivedData.expires_in || 5184000 // 60 days default

    // Step 3: Get user's Facebook Pages
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,picture&access_token=${accessToken}`
    )
    const pagesData = await pagesRes.json()

    if (pagesData.error) {
      console.error('Pages fetch error:', pagesData.error)
      return clearNonceCookie(connectionsRedirect({ error: pagesData.error.message }))
    }

    if (!pagesData.data?.length) {
      return clearNonceCookie(
        connectionsRedirect({
          error: 'no_pages',
          message: 'No Facebook Pages found. Please create a Facebook Page first.',
        })
      )
    }

    // Step 4: Save all pages as connections (tokens encrypted at rest)
    let savedCount = 0
    for (const page of pagesData.data) {
      try {
        await saveSocialConnection({
          propertyId,
          userId,
          platform: 'facebook',
          accountId: page.id,
          accountName: page.name,
          accountAvatarUrl: page.picture?.data?.url,
          accessToken,
          tokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
          pageId: page.id,
          pageAccessToken: page.access_token,
          scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
          rawProfile: page,
        })
        savedCount++
      } catch (saveError) {
        console.error('Error saving Facebook page connection:', saveError)
      }
    }

    if (savedCount === 0) {
      return clearNonceCookie(connectionsRedirect({ error: 'save_failed' }))
    }

    return clearNonceCookie(
      connectionsRedirect({ connected: 'facebook', count: String(savedCount) })
    )
  } catch (error) {
    console.error('Facebook callback error:', error)
    return clearNonceCookie(connectionsRedirect({ error: 'Connection failed' }))
  }
}
