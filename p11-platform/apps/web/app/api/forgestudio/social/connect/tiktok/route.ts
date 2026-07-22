import { NextRequest, NextResponse } from 'next/server'
import { getTikTokCredentials } from '@/utils/forgestudio/social-config'
import {
  beginForgeStudioOAuthConnect,
  connectionsRedirect,
  getSiteUrl,
  redirectToProvider,
} from '@/utils/forgestudio/oauth-flow'

// TikTok OAuth - Start the connection flow (manager/admin only).
export async function GET(request: NextRequest) {
  try {
    const context = await beginForgeStudioOAuthConnect(request)
    if (context instanceof NextResponse) {
      return context
    }

    const credentials = await getTikTokCredentials(context.propertyId)
    if (!credentials) {
      return connectionsRedirect({
        setup_required: 'tiktok',
        propertyId: context.propertyId,
      })
    }

    const redirectUri = `${getSiteUrl()}/api/forgestudio/social/callback/tiktok`

    // user.info.basic for identity, video.publish + video.upload for direct posting.
    const scopes = ['user.info.basic', 'video.publish', 'video.upload'].join(',')

    const authUrl = new URL('https://www.tiktok.com/v2/auth/authorize/')
    authUrl.searchParams.set('client_key', credentials.appId)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', scopes)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('state', context.state)

    return redirectToProvider(authUrl.toString(), context.nonce)
  } catch (error) {
    console.error('TikTok OAuth error:', error)
    return connectionsRedirect({ error: 'Failed to start TikTok connection' })
  }
}
