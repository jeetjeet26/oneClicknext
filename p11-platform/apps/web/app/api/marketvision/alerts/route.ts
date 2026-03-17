/**
 * MarketVision 360 - Market Alerts API
 * Manage and retrieve market intelligence alerts
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

export interface MarketAlert {
  id: string
  propertyId: string
  competitorId: string | null
  competitorName?: string
  alertType: 'price_drop' | 'price_increase' | 'new_special' | 'availability_change' | 'new_competitor' | 'competitor_update'
  severity: 'info' | 'warning' | 'critical'
  title: string
  description: string | null
  data: Record<string, unknown>
  isRead: boolean
  isDismissed: boolean
  readAt: string | null
  createdAt: string
}

// GET: List alerts for a property
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const propertyId = searchParams.get('propertyId')
    const unreadOnly = searchParams.get('unreadOnly') === 'true'
    const limit = parseInt(searchParams.get('limit') || '50')
    const alertTypes = searchParams.get('types')?.split(',')

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Build query
    let query = supabase
      .from('market_alerts')
      .select(`
        *,
        competitor:competitors(name)
      `)
      .eq('property_id', propertyId)
      .eq('is_dismissed', false)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (unreadOnly) {
      query = query.eq('is_read', false)
    }

    if (alertTypes && alertTypes.length > 0) {
      query = query.in('alert_type', alertTypes)
    }

    const { data: alerts, error } = await query

    if (error) {
      console.error('Error fetching alerts:', error)
      return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 })
    }

    // Get unread count
    const { count: unreadCount } = await supabase
      .from('market_alerts')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', propertyId)
      .eq('is_read', false)
      .eq('is_dismissed', false)

    return NextResponse.json({
      alerts: alerts?.map(formatAlert) || [],
      unreadCount: unreadCount || 0,
      total: alerts?.length || 0
    })
  } catch (error) {
    console.error('MarketVision Alerts GET Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT: Mark alerts as read/dismissed
export async function PUT(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { alertIds, action, propertyId } = body

    if (!action || !['read', 'dismiss', 'read_all', 'dismiss_all'].includes(action)) {
      return NextResponse.json({ error: 'Valid action required (read, dismiss, read_all, dismiss_all)' }, { status: 400 })
    }

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Bulk actions for property
    if (action === 'read_all' || action === 'dismiss_all') {
      if (!propertyId) {
        return NextResponse.json({ error: 'propertyId required for bulk actions' }, { status: 400 })
      }

      const updates = action === 'read_all' 
        ? { is_read: true, read_at: new Date().toISOString() }
        : { is_dismissed: true }

      const { error } = await supabase
        .from('market_alerts')
        .update(updates)
        .eq('property_id', propertyId)
        .eq('is_dismissed', false)

      if (error) {
        console.error('Error updating alerts:', error)
        return NextResponse.json({ error: 'Failed to update alerts' }, { status: 500 })
      }

      return NextResponse.json({ success: true, action })
    }

    // Individual alert actions
    if (!alertIds || !Array.isArray(alertIds) || alertIds.length === 0) {
      return NextResponse.json({ error: 'alertIds required' }, { status: 400 })
    }

    const updates = action === 'read' 
      ? { is_read: true, read_at: new Date().toISOString() }
      : { is_dismissed: true }

    const { error } = await supabase
      .from('market_alerts')
      .update(updates)
      .in('id', alertIds)
      .eq('property_id', propertyId)

    if (error) {
      console.error('Error updating alerts:', error)
      return NextResponse.json({ error: 'Failed to update alerts' }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true, 
      updated: alertIds.length,
      action
    })
  } catch (error) {
    console.error('MarketVision Alerts PUT Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST: Create manual alert
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { 
      propertyId, 
      competitorId, 
      alertType, 
      severity,
      title, 
      description, 
      data 
    } = body

    if (!propertyId || !alertType || !title) {
      return NextResponse.json({ error: 'propertyId, alertType, and title required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: alert, error } = await supabase
      .from('market_alerts')
      .insert({
        property_id: propertyId,
        competitor_id: competitorId || null,
        alert_type: alertType,
        severity: severity || 'info',
        title,
        description: description || null,
        data: data || {}
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating alert:', error)
      return NextResponse.json({ error: 'Failed to create alert' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      alert: formatAlert(alert)
    }, { status: 201 })
  } catch (error) {
    console.error('MarketVision Alerts POST Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function formatAlert(data: Record<string, unknown>): MarketAlert {
  return {
    id: data.id as string,
    propertyId: data.property_id as string,
    competitorId: data.competitor_id as string | null,
    competitorName: (data.competitor as Record<string, unknown>)?.name as string | undefined,
    alertType: data.alert_type as MarketAlert['alertType'],
    severity: data.severity as MarketAlert['severity'],
    title: data.title as string,
    description: data.description as string | null,
    data: (data.data as Record<string, unknown>) || {},
    isRead: data.is_read as boolean,
    isDismissed: data.is_dismissed as boolean,
    readAt: data.read_at as string | null,
    createdAt: data.created_at as string
  }
}

