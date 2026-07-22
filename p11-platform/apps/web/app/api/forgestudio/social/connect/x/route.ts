import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getXCredentials } from '@/utils/forgestudio/social-config'
import {
  beginForgeStudioOAuthConnect,
  connectionsRedirect,
  getSiteUrl,
  redirectToProvider,
} from '@/utils/forgestudio/oauth-flow'

const X_PKCE_COOKIE = 'fs_x_pkce'

// X (Twitter) OAuth 2.0 with PKCE - Start the connection flow (manager/admin only).
export async function GET(request: NextRequest) {
  try {
    const context = await beginForgeStudioOAuthConnect(request)
    if (context instanceof NextResponse) {
      return context
    }

    const credentials = await getXCredentials(context.propertyId)
    if (!credentials) {
      return connectionsRedirect({
        setup_required: 'x',
        propertyId: context.propertyId,
      })
    }

    const redirectUri = `${getSiteUrl()}/api/forgestudio/social/callback/x`

    // PKCE: S256 challenge; the verifier travels in an httpOnly cookie.
    const codeVerifier = crypto.randomBytes(32).toString('base64url')
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

    const scopes = ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write']

    const authUrl = new URL('https://x.com/i/oauth2/authorize')
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('client_id', credentials.appId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('scope', scopes.join(' '))
    authUrl.searchParams.set('state', context.state)
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')

    const response = redirectToProvider(authUrl.toString(), context.nonce)
    response.cookies.set(X_PKCE_COOKIE, codeVerifier, {
      httpOnly: true,
      secure: getSiteUrl().startsWith('https'),
      sameSite: 'lax',
      path: '/api/forgestudio/social/callback',
      maxAge: 15 * 60,
    })
    return response
  } catch (error) {
    console.error('X OAuth error:', error)
    return connectionsRedirect({ error: 'Failed to start X connection' })
  }
}
