import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getLinkedInCredentials } from '@/utils/forgestudio/social-config'
import { verifySignedForgeStudioOAuthState } from '@/utils/services/forgestudio-oauth-state'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// LinkedIn OAuth Callback
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
      console.error('LinkedIn OAuth error:', error, errorDescription)
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
    const credentials = await getLinkedInCredentials(propertyId)
    const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL}/api/forgestudio/social/callback/linkedin`

    if (!credentials) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=missing_config&setup_required=linkedin`
      )
    }

    // Step 1: Exchange code for access token
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: credentials.appId,
        client_secret: credentials.appSecret
      })
    })

    const tokenData = await tokenRes.json()

    if (tokenData.error) {
      console.error('LinkedIn token exchange error:', tokenData)
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=${encodeURIComponent(tokenData.error_description || tokenData.error)}`
      )
    }

    const accessToken = tokenData.access_token
    const expiresIn = tokenData.expires_in || 5184000 // 60 days default

    // Step 2: Get user profile
    const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { 
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })

    if (!profileRes.ok) {
      console.error('LinkedIn profile fetch failed:', await profileRes.text())
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=${encodeURIComponent('Failed to fetch LinkedIn profile')}`
      )
    }

    const profile = await profileRes.json()

    // Step 3: Save connection
    const { error: saveError } = await supabase
      .from('social_connections')
      .upsert({
        property_id: propertyId,
        platform: 'linkedin',
        account_id: profile.sub,
        account_name: profile.name,
        account_username: profile.email,
        account_avatar_url: profile.picture,
        access_token: accessToken,
        token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        scopes: ['openid', 'profile', 'w_member_social'],
        is_active: true,
        raw_profile: profile
      }, {
        onConflict: 'property_id,platform,account_id'
      })

    if (saveError) {
      console.error('Error saving LinkedIn connection:', saveError)
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=save_failed`
      )
    }

    // Success! Redirect back to ForgeStudio
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&connected=linkedin&account=${encodeURIComponent(profile.name)}`
    )

  } catch (error) {
    console.error('LinkedIn callback error:', error)
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=${encodeURIComponent('Connection failed')}`
    )
  }
}
