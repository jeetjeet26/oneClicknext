import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createSignedForgeStudioOAuthState } from '@/utils/services/forgestudio-oauth-state'
import { getMetaCredentials } from '@/utils/forgestudio/social-config'

// Facebook OAuth - Start the connection flow
// This redirects to Meta's OAuth page (same app as Instagram)
export async function GET(request: NextRequest) {
  try {
    const supabaseAuth = await createClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
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

    // Get Meta credentials (shared with Instagram - same app)
    const credentials = await getMetaCredentials(propertyId)
    
    if (!credentials) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&setup_required=facebook&propertyId=${propertyId}`
      )
    }

    const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL}/api/forgestudio/social/callback/facebook`
    
    const state = createSignedForgeStudioOAuthState({ propertyId })

    // Facebook requires pages_manage_posts for posting
    const scopes = [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts', // Required for posting
      'business_management'
    ].join(',')

    const authUrl = new URL('https://www.facebook.com/v18.0/dialog/oauth')
    authUrl.searchParams.set('client_id', credentials.appId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('scope', scopes)
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('response_type', 'code')

    return NextResponse.redirect(authUrl.toString())

  } catch (error) {
    console.error('Facebook OAuth error:', error)
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=${encodeURIComponent('Failed to start Facebook connection')}`
    )
  }
}
