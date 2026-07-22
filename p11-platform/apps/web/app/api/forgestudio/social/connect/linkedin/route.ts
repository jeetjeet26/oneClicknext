import { NextRequest, NextResponse } from 'next/server'
import { getLinkedInCredentials } from '@/utils/forgestudio/social-config'
import {
  beginForgeStudioOAuthConnect,
  connectionsRedirect,
  getSiteUrl,
  redirectToProvider,
} from '@/utils/forgestudio/oauth-flow'

// LinkedIn OAuth - Start the connection flow (manager/admin only).
export async function GET(request: NextRequest) {
  try {
    const context = await beginForgeStudioOAuthConnect(request)
    if (context instanceof NextResponse) {
      return context
    }

    const credentials = await getLinkedInCredentials(context.propertyId)
    if (!credentials) {
      return connectionsRedirect({
        setup_required: 'linkedin',
        propertyId: context.propertyId,
      })
    }

    const redirectUri = `${getSiteUrl()}/api/forgestudio/social/callback/linkedin`

    // openid/profile for identity, w_member_social to post on behalf of the member.
    const scopes = ['openid', 'profile', 'w_member_social'].join(' ')

    const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization')
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('client_id', credentials.appId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('scope', scopes)
    authUrl.searchParams.set('state', context.state)

    return redirectToProvider(authUrl.toString(), context.nonce)
  } catch (error) {
    console.error('LinkedIn OAuth error:', error)
    return connectionsRedirect({ error: 'Failed to start LinkedIn connection' })
  }
}
