import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { logAuditEvent } from '@/utils/audit'
import { isPlatformOperator } from '@/utils/services/platform-operator'
import { findGoogleAdsAdvertiser, formatGoogleAdsCustomerId, readGoogleAdsAgency } from '@/utils/marketvision/google-ads-agency'
import { validatePropertyAccess, validatePropertyManagerAccess } from '@/utils/services/auth-guard'

const CONNECTION_COLUMNS = 'id,property_id,platform,account_id,account_name,manager_account_id,is_active,connected_by,connected_at,created_at,updated_at,last_sync_at,last_sync_status,last_synced_at,last_imported_at,error_count,currency,account_timezone'

// GET - List all ad account connections for a property or org
export async function GET(request: NextRequest) {
  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // The authenticated client keeps community-level RLS active for an org-wide list.
  const supabase = supabaseAuth

  try {
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('property_id')
    const platform = searchParams.get('platform')

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'No organization found' }, { status: 400 })
    }

    if (propertyId !== null && !(await validatePropertyAccess(user.id, propertyId)).authorized) {
      return NextResponse.json({ error: 'Community access is required' }, { status: 403 })
    }

    // Build query
    let query = supabase
      .from('ad_account_connections')
      .select(`
        ${CONNECTION_COLUMNS},
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

    const [{ data: connections, error }, management] = await Promise.all([
      query.order('created_at', { ascending: false }),
      propertyId && ['admin', 'manager'].includes(profile.role ?? '')
        ? validatePropertyManagerAccess(user.id, propertyId)
        : null,
    ])

    if (error) {
      console.error('Error fetching ad connections:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!propertyId) return NextResponse.json({ connections })
    const canManage = management?.authorized === true
    return NextResponse.json({
      connections,
      canManage,
      canLink: canManage && isPlatformOperator(user.id, profile.role),
    })
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

    // Linking an arbitrary account lets the import worker use shared provider
    // credentials on its behalf. Only a platform operator may provision it.
    if (!isPlatformOperator(user.id, userRole)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    if (typeof property_id !== 'string' || !(await validatePropertyManagerAccess(user.id, property_id)).authorized) {
      return NextResponse.json({ error: 'Property management access is required' }, { status: 403 })
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

    if (platform === 'google_ads') {
      const saved = await readGoogleAdsAgency(supabase, profile.org_id)
      if (saved) {
        if (!saved.refreshToken) return NextResponse.json({ error: 'Authorize Google Ads in Agency advertising settings.' }, { status: 409 })
        const selectedId = typeof account_id === 'string' ? account_id.trim().replaceAll('-', '') : ''
        const advertiser = await findGoogleAdsAdvertiser({ ...saved.app, refreshToken: saved.refreshToken }, selectedId)
        if (!advertiser) return NextResponse.json({ error: 'Choose an advertiser under the authorized Google Ads manager.' }, { status: 400 })

        const accountId = formatGoogleAdsCustomerId(advertiser.id)
        const accountName = advertiser.descriptiveName || `Account ${accountId}`
        const { data: connection, error } = await supabase.rpc('link_google_ads_agency_account', {
          p_org_id: profile.org_id, p_actor_id: user.id, p_property_id: property_id,
          p_revision: saved.revision, p_account_id: accountId, p_account_name: accountName,
          p_manager_id: formatGoogleAdsCustomerId(saved.app.managerId),
        })
        if (error?.code === '23505') return NextResponse.json({ error: 'This advertiser is already linked to a community.' }, { status: 409 })
        if (error) throw new Error('Could not link Google Ads advertiser')
        if (!connection || typeof connection !== 'object' || Array.isArray(connection) || typeof connection.id !== 'string') return NextResponse.json({ error: 'The Google Ads authorization changed. Reload the accounts and try again.' }, { status: 409 })

        await logAuditEvent({
          action: 'create', entityType: 'ad_account_connection', entityId: connection.id, entityName: `google_ads:${accountId}`,
          details: { property_id, property_name: property.name, platform, account_id: accountId, account_name: accountName },
          request,
        })
        return NextResponse.json({ connection }, { status: 201 })
      }
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
      .select(CONNECTION_COLUMNS)
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
    const propertyId = searchParams.get('property_id')

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
    let connectionQuery = supabase
      .from('ad_account_connections')
      .select('id,property_id,platform,account_id,account_name,properties(name)')
      .eq('id', connectionId)
      .eq('org_id', profile.org_id)
    if (propertyId !== null) connectionQuery = connectionQuery.eq('property_id', propertyId)
    const { data: connectionToDelete } = await connectionQuery.single()

    if (!connectionToDelete) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    if (!connectionToDelete.property_id || !(await validatePropertyManagerAccess(user.id, connectionToDelete.property_id)).authorized) {
      return NextResponse.json({ error: 'Property management access is required' }, { status: 403 })
    }

    // Delete the connection
    const { error } = await supabase
      .from('ad_account_connections')
      .delete()
      .eq('id', connectionId)
      .eq('org_id', profile.org_id)
      .eq('property_id', connectionToDelete.property_id)

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

    const { data: existingConnection, error: readError } = await supabase
      .from('ad_account_connections')
      .select('id,property_id')
      .eq('id', id)
      .eq('org_id', profile.org_id)
      .single()
    if (readError || !existingConnection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }
    if (!existingConnection.property_id || !(await validatePropertyManagerAccess(user.id, existingConnection.property_id)).authorized) {
      return NextResponse.json({ error: 'Property management access is required' }, { status: 403 })
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
      .eq('property_id', existingConnection.property_id)
      .select(CONNECTION_COLUMNS)
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














