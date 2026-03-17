import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('reviewflow_config')
      .select('*')
      .eq('property_id', propertyId)
      .single()

    if (error && error.code !== 'PGRST116') { // PGRST116 = not found
      console.error('Error fetching config:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Return default config if none exists
    if (!data) {
      return NextResponse.json({
        config: {
          property_id: propertyId,
          auto_respond_positive: false,
          auto_respond_threshold: 4,
          response_delay_minutes: 30,
          default_tone: 'professional',
          notify_on_negative: true,
          notify_on_urgent: true,
          poll_frequency_hours: 6,
          is_active: false
        }
      })
    }

    return NextResponse.json({ config: data })
  } catch (error) {
    console.error('ReviewFlow GET /config error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    
    const { propertyId, ...configData } = body

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('reviewflow_config')
      .upsert({
        property_id: propertyId,
        ...configData,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'property_id'
      })
      .select()
      .single()

    if (error) {
      console.error('Error saving config:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ config: data })
  } catch (error) {
    console.error('ReviewFlow POST /config error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    
    const { propertyId, ...updates } = body

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check if config exists
    const { data: existing } = await supabase
      .from('reviewflow_config')
      .select('id')
      .eq('property_id', propertyId)
      .single()

    if (!existing) {
      // Create new config with updates
      const { data, error } = await supabase
        .from('reviewflow_config')
        .insert({
          property_id: propertyId,
          ...updates
        })
        .select()
        .single()

      if (error) {
        console.error('Error creating config:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ config: data })
    }

    // Update existing config
    const { data, error } = await supabase
      .from('reviewflow_config')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('property_id', propertyId)
      .select()
      .single()

    if (error) {
      console.error('Error updating config:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ config: data })
  } catch (error) {
    console.error('ReviewFlow PATCH /config error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

