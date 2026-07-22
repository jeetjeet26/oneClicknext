import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyManagerAccess } from '@/utils/services/auth-guard'
import { encryptSecret } from '@/utils/forgestudio/crypto'

const PLATFORMS = ['meta', 'linkedin', 'tiktok', 'x'] as const

const configQuerySchema = z.object({
  propertyId: z.string().uuid(),
  platform: z.enum(PLATFORMS).default('meta'),
})

const configPostSchema = z.object({
  propertyId: z.string().uuid(),
  platform: z.enum(PLATFORMS),
  appId: z.string().min(1).max(256),
  appSecret: z.string().min(1).max(1024),
  redirectUri: z.string().url().optional(),
})

function envFallbackConfigured(platform: (typeof PLATFORMS)[number]): boolean {
  switch (platform) {
    case 'meta':
      return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET)
    case 'linkedin':
      return Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET)
    case 'tiktok':
      return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET)
    case 'x':
      return Boolean(
        (process.env.X_CLIENT_ID || process.env.TWITTER_CLIENT_ID) &&
        (process.env.X_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET)
      )
  }
}

// GET - Check if OAuth config exists for a property/platform
export async function GET(request: NextRequest) {
  try {
    const authClient = await createServerClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const parsed = configQuerySchema.safeParse({
      propertyId: searchParams.get('propertyId') ?? undefined,
      platform: searchParams.get('platform') ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.issues },
        { status: 400 }
      )
    }
    const { propertyId, platform } = parsed.data

    const access = await validatePropertyManagerAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: access.error || 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceClient()
    const { data: dbConfig, error: dbError } = await supabase
      .from('social_auth_configs')
      .select('id, platform, app_id, is_configured, last_verified_at, created_at')
      .eq('property_id', propertyId)
      .eq('platform', platform)
      .maybeSingle()

    if (dbError) {
      console.error('Error loading social auth config:', dbError)
      return NextResponse.json({ error: 'Failed to check configuration' }, { status: 500 })
    }

    const hasEnvConfig = envFallbackConfigured(platform)

    return NextResponse.json({
      hasConfig: !!dbConfig || hasEnvConfig,
      configSource: dbConfig ? 'database' : (hasEnvConfig ? 'environment' : null),
      config: dbConfig ? {
        id: dbConfig.id,
        platform: dbConfig.platform,
        appId: dbConfig.app_id,
        isConfigured: dbConfig.is_configured,
        lastVerifiedAt: dbConfig.last_verified_at,
        createdAt: dbConfig.created_at,
      } : null,
    })
  } catch (error) {
    console.error('Error checking social auth config:', error)
    return NextResponse.json({ error: 'Failed to check configuration' }, { status: 500 })
  }
}

// POST - Save OAuth credentials for a property (manager/admin only)
export async function POST(request: NextRequest) {
  try {
    const authClient = await createServerClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const parsed = configPostSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.issues },
        { status: 400 }
      )
    }
    const { propertyId, platform, appId, appSecret, redirectUri } = parsed.data

    const access = await validatePropertyManagerAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: access.error || 'Forbidden' }, { status: 403 })
    }

    // Encrypt the app secret (requires a real ENCRYPTION_KEY; no default)
    const encryptedSecret = encryptSecret(appSecret)

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('social_auth_configs')
      .upsert({
        property_id: propertyId,
        platform,
        app_id: appId,
        app_secret_encrypted: encryptedSecret,
        redirect_uri: redirectUri ?? null,
        is_configured: true,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'property_id,platform',
      })
      .select('id, platform, app_id, is_configured, created_at')
      .single()

    if (error) {
      console.error('Error saving social auth config:', error)
      return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      config: {
        id: data.id,
        platform: data.platform,
        appId: data.app_id,
        isConfigured: data.is_configured,
      },
    })
  } catch (error) {
    console.error('Error saving social auth config:', error)
    const message = error instanceof Error && error.message.includes('ENCRYPTION_KEY')
      ? 'Server encryption key is not configured'
      : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// DELETE - Remove OAuth credentials for a property (manager/admin only)
export async function DELETE(request: NextRequest) {
  try {
    const authClient = await createServerClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const parsed = configQuerySchema.safeParse({
      propertyId: searchParams.get('propertyId') ?? undefined,
      platform: searchParams.get('platform') ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.issues },
        { status: 400 }
      )
    }
    const { propertyId, platform } = parsed.data

    const access = await validatePropertyManagerAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: access.error || 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceClient()
    const { error } = await supabase
      .from('social_auth_configs')
      .delete()
      .eq('property_id', propertyId)
      .eq('platform', platform)

    if (error) {
      console.error('Error deleting social auth config:', error)
      return NextResponse.json({ error: 'Failed to delete configuration' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting social auth config:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
