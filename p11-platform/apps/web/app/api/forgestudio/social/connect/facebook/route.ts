import { NextRequest, NextResponse } from 'next/server'
import { getMetaCredentials } from '@/utils/forgestudio/social-config'
import {
  beginForgeStudioOAuthConnect,
  connectionsRedirect,
  getSiteUrl,
  redirectToProvider,
} from '@/utils/forgestudio/oauth-flow'

// Facebook OAuth - Start the connection flow (manager/admin only).
// Uses the same Meta app as Instagram.
export async function GET(request: NextRequest) {
  try {
    const context = await beginForgeStudioOAuthConnect(request)
    if (context instanceof NextResponse) {
      return context
    }

    const credentials = await getMetaCredentials(context.propertyId)
    if (!credentials) {
      return connectionsRedirect({
        setup_required: 'facebook',
        propertyId: context.propertyId,
      })
    }

    const redirectUri = `${getSiteUrl()}/api/forgestudio/social/callback/facebook`

    // Facebook requires pages_manage_posts for posting
    const scopes = [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
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
    console.error('Facebook OAuth error:', error)
    return connectionsRedirect({ error: 'Failed to start Facebook connection' })
  }
}
