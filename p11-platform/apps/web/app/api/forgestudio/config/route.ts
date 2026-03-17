import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET - Fetch ForgeStudio config for a property
export async function GET(request: NextRequest) {
  try {
    const authClient = await createServerClient()
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      return NextResponse.json(
        { error: 'Property ID required' },
        { status: 400 }
      )
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('forgestudio_config')
      .select('*')
      .eq('property_id', propertyId)
      .single()

    if (error && error.code !== 'PGRST116') { // Not found is OK
      console.error('Error fetching config:', error)
      return NextResponse.json(
        { error: 'Failed to fetch config' },
        { status: 500 }
      )
    }

    // Return default config if none exists
    if (!data) {
      return NextResponse.json({
        config: {
          property_id: propertyId,
          brand_voice: null,
          brand_colors: {},
          target_audience: null,
          key_amenities: [],
          default_ai_model: 'gpt-4o-mini',
          creativity_level: 0.7,
          include_hashtags: true,
          include_cta: true,
          max_caption_length: 2200,
          nanobanana_enabled: false,
          nanobanana_default_style: 'natural',
          nanobanana_quality: 'high',
          instagram_connected: false,
          facebook_connected: false,
          linkedin_connected: false,
          tiktok_connected: false,
          auto_schedule: false,
          preferred_posting_times: {},
          is_active: true
        },
        isDefault: true
      })
    }

    return NextResponse.json({
      config: data,
      isDefault: false
    })

  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Create or update ForgeStudio config
export async function POST(request: NextRequest) {
  try {
    const authClient = await createServerClient()
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { propertyId, ...configData } = body

    if (!propertyId) {
      return NextResponse.json(
        { error: 'Property ID required' },
        { status: 400 }
      )
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check if config exists
    const { data: existing } = await supabase
      .from('forgestudio_config')
      .select('id')
      .eq('property_id', propertyId)
      .single()

    let result

    if (existing) {
      // Update existing config
      const { data, error } = await supabase
        .from('forgestudio_config')
        .update({
          ...configData,
          updated_at: new Date().toISOString()
        })
        .eq('property_id', propertyId)
        .select()
        .single()

      if (error) {
        console.error('Error updating config:', error)
        return NextResponse.json(
          { error: 'Failed to update config' },
          { status: 500 }
        )
      }

      result = data
    } else {
      // Create new config
      const { data, error } = await supabase
        .from('forgestudio_config')
        .insert({
          property_id: propertyId,
          ...configData
        })
        .select()
        .single()

      if (error) {
        console.error('Error creating config:', error)
        return NextResponse.json(
          { error: 'Failed to create config' },
          { status: 500 }
        )
      }

      result = data
    }

    return NextResponse.json({
      success: true,
      config: result
    })

  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

