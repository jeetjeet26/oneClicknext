import { NextRequest, NextResponse } from 'next/server'
import { getMetaCredentials } from '@/utils/forgestudio/social-config'
import {
  clearNonceCookie,
  connectionsRedirect,
  getSiteUrl,
  saveSocialConnection,
  validateForgeStudioOAuthCallback,
} from '@/utils/forgestudio/oauth-flow'

// Instagram/Facebook OAuth Callback
// Exchanges the code for tokens and saves the connection.
export async function GET(request: NextRequest) {
  try {
    const context = await validateForgeStudioOAuthCallback(request)
    if (context instanceof NextResponse) {
      return context
    }
    const { propertyId, userId, code } = context

    const credentials = await getMetaCredentials(propertyId)
    const redirectUri = `${getSiteUrl()}/api/forgestudio/social/callback/instagram`

    if (!credentials) {
      return clearNonceCookie(
        connectionsRedirect({ error: 'missing_config', setup_required: 'instagram' })
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
      return clearNonceCookie(connectionsRedirect({ error: 'token_exchange_failed' }))
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
    const expiresIn = longLivedData.expires_in || 3600

    // Step 3: Get pages the user manages (needed for Instagram Business)
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${accessToken}`
    )
    const pagesData = await pagesRes.json()

    const pagesWithInstagram = (pagesData.data || []).filter(
      (page: { instagram_business_account?: { id: string } }) => page.instagram_business_account
    )

    if (pagesWithInstagram.length === 0) {
      return clearNonceCookie(
        connectionsRedirect({
          error: 'no_instagram_business',
          message:
            'No Instagram Business account found. Please connect your Instagram to a Facebook Page first.',
        })
      )
    }

    // Use the first page with Instagram (account selector is a UI follow-up)
    const page = pagesWithInstagram[0]
    const instagramAccountId = page.instagram_business_account.id
    const pageAccessToken = page.access_token

    // Step 4: Get Instagram account details
    const igRes = await fetch(
      `https://graph.facebook.com/v21.0/${instagramAccountId}?fields=id,username,name,profile_picture_url&access_token=${pageAccessToken}`
    )
    const igData = await igRes.json()

    // Step 5: Save the connection (tokens encrypted at rest)
    try {
      await saveSocialConnection({
        propertyId,
        userId,
        platform: 'instagram',
        accountId: instagramAccountId,
        accountName: igData.name || igData.username,
        accountUsername: igData.username,
        accountAvatarUrl: igData.profile_picture_url,
        accessToken,
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
        pageId: page.id,
        pageAccessToken,
        scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'],
        rawProfile: igData,
      })
    } catch (saveError) {
      console.error('Error saving connection:', saveError)
      return clearNonceCookie(connectionsRedirect({ error: 'save_failed' }))
    }

    return clearNonceCookie(
      connectionsRedirect({ connected: 'instagram', account: igData.username || '' })
    )
  } catch (error) {
    console.error('Instagram callback error:', error)
    return clearNonceCookie(connectionsRedirect({ error: 'callback_failed' }))
  }
}
