import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { logAuditEvent } from '@/utils/audit'

// GET - List all ad account connections for a property or org
export async function GET(request: NextRequest) {
  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  try {
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('property_id')
    const platform = searchParams.get('platform')

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'No organization found' }, { status: 400 })
    }

    // Build query
    let query = supabase
      .from('ad_account_connections')
      .select(`
        *,
        properties (id, name),
        connected_by_profile:profiles!ad_account_connections_connected_by_fkey (full_name)
      `)
      .eq('org_id', profile.org_id)

    if (propertyId) {
      query = query.eq('property_id', propertyId)
    }

    if (platform) {
      query = query.eq('platform', platform)
    }

    const { data: connections, error } = await query.order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching ad connections:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ connections })
  } catch (error) {
    console.error('Ad connections API error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// POST - Create a new ad account connection (link an account to a property)
export async function POST(request: NextRequest) {
  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  try {
    const body = await request.json()
    const { property_id, platform, account_id, account_name, manager_account_id } = body

    if (!property_id || !platform || !account_id) {
      return NextResponse.json(
        { error: 'property_id, platform, and account_id are required' },
        { status: 400 }
      )
    }

    // Validate platform
    const validPlatforms = ['google_ads', 'meta_ads', 'ga4', 'linkedin_ads', 'tiktok_ads']
    if (!validPlatforms.includes(platform)) {
      return NextResponse.json(
        { error: `Invalid platform. Must be one of: ${validPlatforms.join(', ')}` },
        { status: 400 }
      )
    }

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'No organization found' }, { status: 400 })
    }

    const userRole = profile.role ?? ''

    // Check if user has permission
    if (!['admin', 'manager'].includes(userRole)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Verify the property belongs to the user's org
    const { data: property } = await supabase
      .from('properties')
      .select('id, name, org_id')
      .eq('id', property_id)
      .eq('org_id', profile.org_id)
      .single()

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    // Check if this account is already linked
    const { data: existingConnection } = await supabase
      .from('ad_account_connections')
      .select('id, property_id, properties(name)')
      .eq('platform', platform)
      .eq('account_id', account_id)
      .single()

    if (existingConnection) {
      const props = Array.isArray(existingConnection.properties) ? existingConnection.properties[0] : existingConnection.properties
      return NextResponse.json(
        {
          error: `This ${platform} account is already linked to "${props?.name || 'another property'}"`,
        },
        { status: 409 }
      )
    }

    // Create the connection
    const { data: connection, error } = await supabase
      .from('ad_account_connections')
      .insert({
        property_id,
        org_id: profile.org_id,
        platform,
        account_id,
        account_name: account_name || `Account ${account_id}`,
        manager_account_id: manager_account_id || process.env.GOOGLE_ADS_CUSTOMER_ID,
        is_active: true,
        connected_by: user.id,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating ad connection:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Log audit event
    await logAuditEvent({
      action: 'create',
      entityType: 'ad_account_connection',
      entityId: connection.id,
      entityName: `${platform}:${account_id}`,
      details: {
        property_id,
        property_name: property.name,
        platform,
        account_id,
        account_name,
      },
      request,
    })

    return NextResponse.json({ connection }, { status: 201 })
  } catch (error) {
    console.error('Ad connection create error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// DELETE - Remove an ad account connection
export async function DELETE(request: NextRequest) {
  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  try {
    const { searchParams } = new URL(request.url)
    const connectionId = searchParams.get('id')

    if (!connectionId) {
      return NextResponse.json({ error: 'Connection ID is required' }, { status: 400 })
    }

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'No organization found' }, { status: 400 })
    }

    const userRole = profile.role ?? ''

    // Check if user has permission
    if (!['admin', 'manager'].includes(userRole)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Get the connection before deleting for audit log
    const { data: connectionToDelete } = await supabase
      .from('ad_account_connections')
      .select('*, properties(name)')
      .eq('id', connectionId)
      .eq('org_id', profile.org_id)
      .single()

    if (!connectionToDelete) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    // Delete the connection
    const { error } = await supabase
      .from('ad_account_connections')
      .delete()
      .eq('id', connectionId)
      .eq('org_id', profile.org_id)

    if (error) {
      console.error('Error deleting ad connection:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Log audit event
    const props = Array.isArray(connectionToDelete.properties) ? connectionToDelete.properties[0] : connectionToDelete.properties
    await logAuditEvent({
      action: 'delete',
      entityType: 'ad_account_connection',
      entityId: connectionId,
      entityName: `${connectionToDelete.platform}:${connectionToDelete.account_id}`,
      details: {
        property_name: props?.name,
        platform: connectionToDelete.platform,
        account_name: connectionToDelete.account_name,
      },
      request,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Ad connection delete error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// PATCH - Update connection status (activate/deactivate)
export async function PATCH(request: NextRequest) {
  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  try {
    const body = await request.json()
    const { id, is_active } = body

    if (!id) {
      return NextResponse.json({ error: 'Connection ID is required' }, { status: 400 })
    }

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'No organization found' }, { status: 400 })
    }

    const userRole = profile.role ?? ''

    // Check if user has permission
    if (!['admin', 'manager'].includes(userRole)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Update the connection
    const { data: connection, error } = await supabase
      .from('ad_account_connections')
      .update({
        is_active: is_active ?? true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', profile.org_id)
      .select()
      .single()

    if (error) {
      console.error('Error updating ad connection:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ connection })
  } catch (error) {
    console.error('Ad connection update error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}














