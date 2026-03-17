import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createSignedForgeStudioOAuthState } from '@/utils/services/forgestudio-oauth-state'

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Helper to decrypt stored secrets
function decrypt(encrypted: string): string {
  if (encrypted.startsWith('enc_')) {
    return Buffer.from(encrypted.slice(4), 'base64').toString('utf-8')
  }
  if (!encrypted.startsWith('encv1:')) return encrypted
  const key = crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY || 'p11-platform-default-key-change-me').digest()
  const [, ivB64, tagB64, dataB64] = encrypted.split(':')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final()
  ]).toString('utf-8')
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

// Instagram/Facebook OAuth - Start the connection flow
// This redirects to Meta's OAuth page
export async function GET(request: NextRequest) {
  try {
    const authClient = await createServerClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=${encodeURIComponent('Unauthorized')}`
      )
    }

    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      // Redirect back with error instead of returning JSON
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

    // Get credentials from DB or environment
    const credentials = await getMetaCredentials(propertyId)
    
    if (!credentials) {
      // Redirect back with setup_required flag - the UI will show the setup modal
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&setup_required=instagram&propertyId=${propertyId}`
      )
    }

    const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL}/api/forgestudio/social/callback/instagram`
    
    const state = createSignedForgeStudioOAuthState({ propertyId })

    // Required scopes for Instagram posting via Facebook Pages
    const scopes = [
      'instagram_basic',
      'instagram_content_publish',
      'pages_show_list',
      'pages_read_engagement',
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
    console.error('Instagram OAuth error:', error)
    // Redirect back with error instead of returning JSON
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/forgestudio?tab=connections&error=${encodeURIComponent('Failed to start Instagram connection')}`
    )
  }
}

