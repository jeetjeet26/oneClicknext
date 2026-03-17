import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  return { supabase, user, error }
}

// GET - List platform connections for a property
export async function GET(request: NextRequest) {
  try {
    const { supabase, user, error: authError } = await getAuthenticatedUser()
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      return NextResponse.json(
        { error: 'propertyId is required' },
        { status: 400 }
      )
    }

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('review_platform_connections')
      .select('*')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching connections:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ connections: data })

  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Create a new platform connection
export async function POST(request: NextRequest) {
  try {
    const { supabase, user, error: authError } = await getAuthenticatedUser()
    const body = await request.json()
    const { 
      propertyId, 
      platform, 
      // Google fields
      placeId, 
      googleMapsUrl,
      apiKey,
      // Yelp fields
      yelpBusinessId,
      yelpBusinessUrl,
      // Connection config
      connectionType = 'api',
      syncFrequency = 'hourly',
      accessToken,
      // Metadata
      limitationNote
    } = body

    if (!propertyId || !platform) {
      return NextResponse.json(
        { error: 'propertyId and platform are required' },
        { status: 400 }
      )
    }

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Validate platform
    const validPlatforms = ['google', 'yelp', 'apartments_com', 'facebook']
    if (!validPlatforms.includes(platform)) {
      return NextResponse.json(
        { error: `Invalid platform. Must be one of: ${validPlatforms.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate connection type
    const validTypes = ['api', 'scraper', 'manual']
    if (!validTypes.includes(connectionType)) {
      return NextResponse.json(
        { error: `Invalid connection type. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      )
    }

    // Platform-specific validation
    if (platform === 'google') {
      if (!placeId && !googleMapsUrl) {
        return NextResponse.json(
          { error: 'Google Place ID or Google Maps URL is required for Google connections' },
          { status: 400 }
        )
      }
    }

    if (platform === 'yelp') {
      if (!yelpBusinessId && !yelpBusinessUrl) {
        return NextResponse.json(
          { error: 'Yelp Business ID or Yelp Business URL is required for Yelp connections' },
          { status: 400 }
        )
      }
    }

    // Check if connection already exists
    const { data: existing } = await supabase
      .from('review_platform_connections')
      .select('id')
      .eq('property_id', propertyId)
      .eq('platform', platform)
      .single()

    const connectionData = {
      place_id: placeId || null,
      google_maps_url: googleMapsUrl || null,
      api_key: apiKey || null,
      access_token: accessToken || null,
      yelp_business_id: yelpBusinessId || null,
      yelp_business_url: yelpBusinessUrl || null,
      connection_type: connectionType,
      sync_frequency: syncFrequency,
      limitation_note: limitationNote || (platform === 'yelp' ? 'Yelp API returns only 3 most recent reviews' : null),
      is_active: true,
      error_count: 0,
      last_error: null,
      updated_at: new Date().toISOString()
    }

    if (existing) {
      // Update existing connection
      const { data, error } = await supabase
        .from('review_platform_connections')
        .update(connectionData)
        .eq('id', existing.id)
        .select()
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ connection: data, updated: true })
    }

    // Create new connection
    const { data, error } = await supabase
      .from('review_platform_connections')
      .insert({
        property_id: propertyId,
        platform,
        ...connectionData
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating connection:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ connection: data })

  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// PATCH - Update a platform connection
export async function PATCH(request: NextRequest) {
  try {
    const { supabase, user, error: authError } = await getAuthenticatedUser()
    const body = await request.json()
    const { 
      connectionId,
      placeId,
      googleMapsUrl,
      apiKey,
      yelpBusinessId,
      yelpBusinessUrl,
      connectionType,
      syncFrequency,
      isActive,
      accessToken
    } = body

    if (!connectionId) {
      return NextResponse.json(
        { error: 'connectionId is required' },
        { status: 400 }
      )
    }

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: existingConnection, error: existingConnectionError } = await supabase
      .from('review_platform_connections')
      .select('id, property_id')
      .eq('id', connectionId)
      .single()

    if (existingConnectionError || !existingConnection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    if (typeof existingConnection.property_id !== 'string') {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, existingConnection.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    }

    // Only update fields that are provided
    if (placeId !== undefined) updateData.place_id = placeId
    if (googleMapsUrl !== undefined) updateData.google_maps_url = googleMapsUrl
    if (apiKey !== undefined) updateData.api_key = apiKey
    if (yelpBusinessId !== undefined) updateData.yelp_business_id = yelpBusinessId
    if (yelpBusinessUrl !== undefined) updateData.yelp_business_url = yelpBusinessUrl
    if (connectionType !== undefined) updateData.connection_type = connectionType
    if (syncFrequency !== undefined) updateData.sync_frequency = syncFrequency
    if (isActive !== undefined) updateData.is_active = isActive
    if (accessToken !== undefined) updateData.access_token = accessToken

    const { data, error } = await supabase
      .from('review_platform_connections')
      .update(updateData)
      .eq('id', connectionId)
      .select()
      .single()

    if (error) {
      console.error('Error updating connection:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ connection: data })

  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE - Remove a platform connection
export async function DELETE(request: NextRequest) {
  try {
    const { supabase, user, error: authError } = await getAuthenticatedUser()
    const { searchParams } = new URL(request.url)
    const connectionId = searchParams.get('connectionId')

    if (!connectionId) {
      return NextResponse.json(
        { error: 'connectionId is required' },
        { status: 400 }
      )
    }

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: existingConnection, error: existingConnectionError } = await supabase
      .from('review_platform_connections')
      .select('id, property_id')
      .eq('id', connectionId)
      .single()

    if (existingConnectionError || !existingConnection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    if (typeof existingConnection.property_id !== 'string') {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, existingConnection.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await supabase
      .from('review_platform_connections')
      .delete()
      .eq('id', connectionId)

    if (error) {
      console.error('Error deleting connection:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
