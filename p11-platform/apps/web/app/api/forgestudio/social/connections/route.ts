import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET - List connected social accounts for a property
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
      .from('social_connections')
      .select(`
        id,
        platform,
        account_id,
        account_name,
        account_username,
        account_avatar_url,
        is_active,
        scopes,
        token_expires_at,
        last_used_at,
        last_error,
        created_at
      `)
      .eq('property_id', propertyId)
      .order('platform')

    if (error) {
      console.error('Error fetching connections:', error)
      return NextResponse.json(
        { error: 'Failed to fetch connections' },
        { status: 500 }
      )
    }

    // Check which tokens are expiring soon
    const connections = (data || []).map(conn => ({
      ...conn,
      needs_refresh: conn.token_expires_at 
        ? new Date(conn.token_expires_at) < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        : false
    }))

    return NextResponse.json({ connections })

  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE - Disconnect a social account
export async function DELETE(request: NextRequest) {
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
    const connectionId = searchParams.get('connectionId')

    if (!connectionId) {
      return NextResponse.json(
        { error: 'Connection ID required' },
        { status: 400 }
      )
    }

    const { data: connection, error: connectionError } = await supabase
      .from('social_connections')
      .select('id, property_id')
      .eq('id', connectionId)
      .single()

    if (connectionError || !connection) {
      return NextResponse.json(
        { error: 'Connection not found' },
        { status: 404 }
      )
    }

    const access = await validatePropertyAccess(user.id, connection.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await supabase
      .from('social_connections')
      .delete()
      .eq('id', connectionId)

    if (error) {
      console.error('Error disconnecting:', error)
      return NextResponse.json(
        { error: 'Failed to disconnect account' },
        { status: 500 }
      )
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

