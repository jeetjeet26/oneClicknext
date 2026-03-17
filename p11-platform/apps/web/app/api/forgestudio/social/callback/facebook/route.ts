import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getMetaCredentials } from '@/utils/forgestudio/social-config'
import { verifySignedForgeStudioOAuthState } from '@/utils/services/forgestudio-oauth-state'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Facebook OAuth Callback
// Exchanges the code for tokens and saves the connection
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')

    // Handle OAuth errors
    if (error) {
      console.error('Facebook OAuth error:', error, errorDescription)
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=${encodeURIComponent(errorDescription || error)}`
      )
    }

    if (!code || !state) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=missing_params`
      )
    }

    // Verify signed state and extract property context
    let propertyId: string
    try {
      const stateData = verifySignedForgeStudioOAuthState(state)
      propertyId = stateData.propertyId
    } catch {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=invalid_state`
      )
    }

    // Get credentials from DB or environment
    const credentials = await getMetaCredentials(propertyId)
    const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL}/api/forgestudio/social/callback/facebook`

    if (!credentials) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=missing_config&setup_required=facebook`
      )
    }
    
    const { appId: clientId, appSecret: clientSecret } = credentials

    // Step 1: Exchange code for short-lived access token
    const tokenUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token')
    tokenUrl.searchParams.set('client_id', clientId)
    tokenUrl.searchParams.set('client_secret', clientSecret)
    tokenUrl.searchParams.set('redirect_uri', redirectUri)
    tokenUrl.searchParams.set('code', code)

    const tokenRes = await fetch(tokenUrl.toString())
    const tokenData = await tokenRes.json()

    if (tokenData.error) {
      console.error('Token exchange error:', tokenData.error)
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=${encodeURIComponent(tokenData.error.message || 'Token exchange failed')}`
      )
    }

    const shortLivedToken = tokenData.access_token

    // Step 2: Exchange for long-lived token (60 days)
    const longLivedUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token')
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
      `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token,picture&access_token=${accessToken}`
    )
    const pagesData = await pagesRes.json()

    if (pagesData.error) {
      console.error('Pages fetch error:', pagesData.error)
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=${encodeURIComponent(pagesData.error.message)}`
      )
    }

    if (!pagesData.data?.length) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=no_pages&message=${encodeURIComponent('No Facebook Pages found. Please create a Facebook Page first.')}`
      )
    }

    // Step 4: Save all pages as connections
    let savedCount = 0
    for (const page of pagesData.data) {
      const { error: saveError } = await supabase
        .from('social_connections')
        .upsert({
          property_id: propertyId,
          platform: 'facebook',
          account_id: page.id,
          account_name: page.name,
          account_avatar_url: page.picture?.data?.url,
          page_id: page.id,
          page_access_token: page.access_token, // Page token never expires
          access_token: accessToken,
          token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
          scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
          is_active: true,
          raw_profile: page
        }, {
          onConflict: 'property_id,platform,account_id'
        })

      if (!saveError) {
        savedCount++
      } else {
        console.error('Error saving Facebook page connection:', saveError)
      }
    }

    // Success! Redirect back to ForgeStudio
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&connected=facebook&count=${savedCount}`
    )

  } catch (error) {
    console.error('Facebook callback error:', error)
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=${encodeURIComponent('Connection failed')}`
    )
  }
}
