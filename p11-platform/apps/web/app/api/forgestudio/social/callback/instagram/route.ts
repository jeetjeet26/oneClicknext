import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifySignedForgeStudioOAuthState } from '@/utils/services/forgestudio-oauth-state'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Helper to decrypt stored secrets
function decrypt(encrypted: string): string {
  if (!encrypted.startsWith('enc_')) return encrypted
  const mixed = encrypted.slice(4)
  return Buffer.from(mixed, 'base64').toString('utf-8')
}

// Get Meta credentials from DB or env
async function getMetaCredentials(propertyId: string): Promise<{
  appId: string
  appSecret: string
} | null> {
  // First check database
  const { data } = await supabase
    .from('social_auth_configs')
    .select('app_id, app_secret_encrypted')
    .eq('property_id', propertyId)
    .eq('platform', 'meta')
    .single()

  if (data) {
    return {
      appId: data.app_id,
      appSecret: decrypt(data.app_secret_encrypted)
    }
  }

  // Fallback to environment variables
  if (process.env.META_APP_ID && process.env.META_APP_SECRET) {
    return {
      appId: process.env.META_APP_ID,
      appSecret: process.env.META_APP_SECRET
    }
  }

  return null
}

// Instagram/Facebook OAuth Callback
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
      console.error('Instagram OAuth error:', error, errorDescription)
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
    const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL}/api/forgestudio/social/callback/instagram`

    if (!credentials) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=missing_config&setup_required=instagram`
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
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?error=token_exchange_failed`
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
    const expiresIn = longLivedData.expires_in || 3600

    // Step 3: Get pages the user manages (needed for Instagram Business)
    const pagesRes = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${accessToken}`
    )
    const pagesData = await pagesRes.json()

    // Find pages with Instagram Business accounts
    const pagesWithInstagram = (pagesData.data || []).filter(
      (page: { instagram_business_account?: { id: string } }) => page.instagram_business_account
    )

    if (pagesWithInstagram.length === 0) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?error=no_instagram_business&message=${encodeURIComponent('No Instagram Business account found. Please connect your Instagram to a Facebook Page first.')}`
      )
    }

    // For now, use the first page with Instagram (could show selector in UI later)
    const page = pagesWithInstagram[0]
    const instagramAccountId = page.instagram_business_account.id
    const pageAccessToken = page.access_token

    // Step 4: Get Instagram account details
    const igRes = await fetch(
      `https://graph.facebook.com/v18.0/${instagramAccountId}?fields=id,username,name,profile_picture_url&access_token=${pageAccessToken}`
    )
    const igData = await igRes.json()

    // Step 6: Save the connection
    const { error: saveError } = await supabase
      .from('social_connections')
      .upsert({
        property_id: propertyId,
        platform: 'instagram',
        account_id: instagramAccountId,
        account_name: igData.name || igData.username,
        account_username: igData.username,
        account_avatar_url: igData.profile_picture_url,
        access_token: accessToken,
        token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        page_id: page.id,
        page_access_token: pageAccessToken,
        scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'],
        is_active: true,
        raw_profile: igData
      }, {
        onConflict: 'property_id,platform,account_id'
      })

    if (saveError) {
      console.error('Error saving connection:', saveError)
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?error=save_failed`
      )
    }

    // Success! Redirect back to ForgeStudio
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?connected=instagram&account=${encodeURIComponent(igData.username)}`
    )

  } catch (error) {
    console.error('Instagram callback error:', error)
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?error=callback_failed`
    )
  }
}

