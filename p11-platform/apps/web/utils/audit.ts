import { createClient } from '@/utils/supabase/server'
import type { Json } from '@/types/supabase'

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
  | 'ad_account_connection'

interface AuditLogParams {
  action: AuditAction
  entityType: EntityType
  entityId?: string | null
  entityName?: string | null
  details?: Record<string, unknown>
  request?: Request
}

/**
 * Server-side utility to log an audit event
 * Call this from API routes after performing actions
 * 
 * @example
 * await logAuditEvent({
 *   action: 'create',
 *   entityType: 'lead',
 *   entityId: newLead.id,
 *   entityName: `${newLead.first_name} ${newLead.last_name}`,
 *   details: { source: 'manual' }
 * })
 */
export async function logAuditEvent(params: AuditLogParams): Promise<void> {
  try {
    const supabase = await createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      console.warn('Audit log: No authenticated user found')
      return
    }

    // Get user's org
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      console.warn('Audit log: No org found for user')
      return
    }

    // Extract IP and user agent from request if provided
    let ip_address: string | null = null
    let user_agent: string | null = null

    if (params.request) {
      ip_address = params.request.headers.get('x-forwarded-for')?.split(',')[0] || 
                   params.request.headers.get('x-real-ip') || 
                   null
      user_agent = params.request.headers.get('user-agent')
    }

    const { error } = await supabase
      .from('audit_logs')
      .insert({
        org_id: profile.org_id,
        user_id: user.id,
        action: params.action,
        entity_type: params.entityType,
        entity_id: params.entityId || null,
        entity_name: params.entityName || null,
        details: (params.details || {}) as Json,
        ip_address,
        user_agent
      })

    if (error) {
      console.error('Failed to create audit log:', error)
    }
  } catch (err) {
    // Don't throw - audit logging should never break the main operation
    console.error('Audit logging error:', err)
  }
}

/**
 * Client-side utility to log an audit event via API
 * Call this from client components after performing actions
 * 
 * @example
 * await logAuditEventClient({
 *   action: 'export',
 *   entityType: 'report',
 *   entityName: 'Monthly Performance Report',
 *   details: { format: 'pdf' }
 * })
 */
export async function logAuditEventClient(params: Omit<AuditLogParams, 'request'>): Promise<void> {
  try {
    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: params.action,
        entity_type: params.entityType,
        entity_id: params.entityId || null,
        entity_name: params.entityName || null,
        details: params.details || {}
      })
    })
  } catch (err) {
    // Don't throw - audit logging should never break the main operation
    console.error('Audit logging error:', err)
  }
}

/**
 * Format an action for display
 */
export function formatAuditAction(action: AuditAction): string {
  const actionLabels: Record<AuditAction, string> = {
    create: 'Created',
    update: 'Updated',
    delete: 'Deleted',
    login: 'Logged in',
    logout: 'Logged out',
    export: 'Exported',
    invite: 'Invited',
    role_change: 'Changed role',
    view: 'Viewed',
    upload: 'Uploaded',
    download: 'Downloaded',
    send_message: 'Sent message',
    schedule_tour: 'Scheduled tour',
    cancel_tour: 'Cancelled tour',
    takeover: 'Took over conversation',
    settings_change: 'Changed settings'
  }
  return actionLabels[action] || action
}

/**
 * Format an entity type for display
 */
export function formatEntityType(entityType: EntityType): string {
  const entityLabels: Record<EntityType, string> = {
    lead: 'Lead',
    property: 'Property',
    document: 'Document',
    user: 'User',
    team_member: 'Team Member',
    conversation: 'Conversation',
    tour: 'Tour',
    report: 'Report',
    workflow: 'Workflow',
    settings: 'Settings',
    organization: 'Organization',
    goal: 'Goal',
    ad_account_connection: 'Ad Account Connection'
  }
  return entityLabels[entityType] || entityType
}

/**
 * Get icon name for an action (Lucide icon names)
 */
export function getAuditActionIcon(action: AuditAction): string {
  const actionIcons: Record<AuditAction, string> = {
    create: 'Plus',
    update: 'Pencil',
    delete: 'Trash2',
    login: 'LogIn',
    logout: 'LogOut',
    export: 'Download',
    invite: 'UserPlus',
    role_change: 'Shield',
    view: 'Eye',
    upload: 'Upload',
    download: 'Download',
    send_message: 'MessageSquare',
    schedule_tour: 'Calendar',
    cancel_tour: 'CalendarX',
    takeover: 'UserCheck',
    settings_change: 'Settings'
  }
  return actionIcons[action] || 'Activity'
}

/**
 * Get color class for an action
 */
export function getAuditActionColor(action: AuditAction): string {
  const colors: Record<string, string> = {
    create: 'text-emerald-600 bg-emerald-50',
    update: 'text-blue-600 bg-blue-50',
    delete: 'text-red-600 bg-red-50',
    login: 'text-green-600 bg-green-50',
    logout: 'text-slate-600 bg-slate-50',
    export: 'text-purple-600 bg-purple-50',
    invite: 'text-indigo-600 bg-indigo-50',
    role_change: 'text-amber-600 bg-amber-50',
    view: 'text-slate-600 bg-slate-50',
    upload: 'text-cyan-600 bg-cyan-50',
    download: 'text-purple-600 bg-purple-50',
    send_message: 'text-blue-600 bg-blue-50',
    schedule_tour: 'text-emerald-600 bg-emerald-50',
    cancel_tour: 'text-red-600 bg-red-50',
    takeover: 'text-amber-600 bg-amber-50',
    settings_change: 'text-slate-600 bg-slate-50'
  }
  return colors[action] || 'text-slate-600 bg-slate-50'
}














