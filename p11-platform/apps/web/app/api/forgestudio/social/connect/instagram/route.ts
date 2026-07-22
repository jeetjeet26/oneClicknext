import { NextRequest, NextResponse } from 'next/server'
import { getMetaCredentials } from '@/utils/forgestudio/social-config'
import {
  beginForgeStudioOAuthConnect,
  connectionsRedirect,
  getSiteUrl,
  redirectToProvider,
} from '@/utils/forgestudio/oauth-flow'

// Instagram/Facebook OAuth - Start the connection flow (manager/admin only).
export async function GET(request: NextRequest) {
  try {
    const context = await beginForgeStudioOAuthConnect(request)
    if (context instanceof NextResponse) {
      return context
    }

    const credentials = await getMetaCredentials(context.propertyId)
    if (!credentials) {
      return connectionsRedirect({
        setup_required: 'instagram',
        propertyId: context.propertyId,
      })
    }

    const redirectUri = `${getSiteUrl()}/api/forgestudio/social/callback/instagram`

    // Required scopes for Instagram posting via Facebook Pages
    const scopes = [
      'instagram_basic',
      'instagram_content_publish',
      'pages_show_list',
      'pages_read_engagement',
      'business_management',
    ].join(',')

    const authUrl = new URL('https://www.facebook.com/v21.0/dialog/oauth')
    authUrl.searchParams.set('client_id', credentials.appId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('scope', scopes)
    authUrl.searchParams.set('state', context.state)
    authUrl.searchParams.set('response_type', 'code')

    return redirectToProvider(authUrl.toString(), context.nonce)
  } catch (error) {
    console.error('Instagram OAuth error:', error)
    return connectionsRedirect({ error: 'Failed to start Instagram connection' })
  }
}
