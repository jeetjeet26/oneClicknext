import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export type AuditAction = 
  | 'create' 
  | 'update' 
  | 'delete' 
  | 'login' 
  | 'logout' 
  | 'export' 
  | 'invite' 
  | 'role_change'
  | 'view'
  | 'upload'
  | 'download'
  | 'send_message'
  | 'schedule_tour'
  | 'cancel_tour'
  | 'takeover'
  | 'settings_change'

export type EntityType = 
  | 'lead'
  | 'property'
  | 'document'
  | 'user'
  | 'team_member'
  | 'conversation'
  | 'tour'
  | 'report'
  | 'workflow'
  | 'settings'
  | 'organization'
  | 'goal'

export type AuditLog = {
  id: string
  org_id: string
  user_id: string | null
  action: AuditAction
  entity_type: EntityType
  entity_id: string | null
  entity_name: string | null
  details: Record<string, unknown>
  ip_address: string | null
  user_agent: string | null
  created_at: string
  // Joined fields
  user?: {
    full_name: string | null
  }
}

// GET /api/audit - Fetch audit logs
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get user's profile to check role and org
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  if (typeof profile.org_id !== 'string') {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  // Only admins can view audit logs
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
  }

  // Parse query parameters
  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')
  const action = searchParams.get('action')
  const entityType = searchParams.get('entity_type')
  const userId = searchParams.get('user_id')
  const startDate = searchParams.get('start_date')
  const endDate = searchParams.get('end_date')
  const search = searchParams.get('search')

  // Build query
  let query = supabase
    .from('audit_logs')
    .select(`
      *,
      user:profiles!audit_logs_user_id_fkey(full_name)
    `, { count: 'exact' })
    .eq('org_id', profile.org_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  // Apply filters
  if (action) {
    query = query.eq('action', action)
  }
  if (entityType) {
    query = query.eq('entity_type', entityType)
  }
  if (userId) {
    query = query.eq('user_id', userId)
  }
  if (startDate) {
    query = query.gte('created_at', startDate)
  }
  if (endDate) {
    query = query.lte('created_at', endDate)
  }
  if (search) {
    query = query.or(`entity_name.ilike.%${search}%,action.ilike.%${search}%`)
  }

  const { data: logs, count, error } = await query

  if (error) {
    console.error('Error fetching audit logs:', error)
    return NextResponse.json({ error: 'Failed to fetch audit logs' }, { status: 500 })
  }

  return NextResponse.json({
    logs: logs || [],
    total: count || 0,
    limit,
    offset
  })
}

// POST /api/audit - Create audit log entry
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get user's profile
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  if (typeof profile.org_id !== 'string') {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  try {
    const body = await request.json()
    const { action, entity_type, entity_id, entity_name, details } = body

    if (!action || !entity_type) {
      return NextResponse.json(
        { error: 'action and entity_type are required' },
        { status: 400 }
      )
    }

    // Get client info
    const ip_address = request.headers.get('x-forwarded-for')?.split(',')[0] || 
                       request.headers.get('x-real-ip') || 
                       null
    const user_agent = request.headers.get('user-agent')

    const { data: log, error } = await supabase
      .from('audit_logs')
      .insert({
        org_id: profile.org_id,
        user_id: user.id,
        action,
        entity_type,
        entity_id,
        entity_name,
        details: details || {},
        ip_address,
        user_agent
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating audit log:', error)
      return NextResponse.json({ error: 'Failed to create audit log' }, { status: 500 })
    }

    return NextResponse.json(log)
  } catch (err) {
    console.error('Error parsing request:', err)
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}



























