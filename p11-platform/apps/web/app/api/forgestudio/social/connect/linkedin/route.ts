import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createSignedForgeStudioOAuthState } from '@/utils/services/forgestudio-oauth-state'
import { getLinkedInCredentials } from '@/utils/forgestudio/social-config'

// LinkedIn OAuth - Start the connection flow
export async function GET(request: NextRequest) {
  try {
    const authClient = await createServerClient()
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=${encodeURIComponent('Unauthorized')}`
      )
    }

    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=${encodeURIComponent('Property ID required')}`
      )
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=${encodeURIComponent('Forbidden')}`
      )
    }

    // Get LinkedIn credentials
    const credentials = await getLinkedInCredentials(propertyId)
    
    if (!credentials) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&setup_required=linkedin&propertyId=${propertyId}`
      )
    }

    const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL}/api/forgestudio/social/callback/linkedin`
    
    const state = createSignedForgeStudioOAuthState({ propertyId })

    // LinkedIn OAuth scopes
    const scopes = [
      'openid',
      'profile',
      'w_member_social' // Post on behalf of user
    ].join(' ')

    const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization')
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('client_id', credentials.appId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('scope', scopes)
    authUrl.searchParams.set('state', state)

    return NextResponse.redirect(authUrl.toString())

  } catch (error) {
    console.error('LinkedIn OAuth error:', error)
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=${encodeURIComponent('Failed to start LinkedIn connection')}`
    )
  }
}
