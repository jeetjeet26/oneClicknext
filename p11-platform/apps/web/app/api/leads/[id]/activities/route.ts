import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  badRequest,
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'

type ActivityType = 
  | 'note' 
  | 'status_change' 
  | 'tour_scheduled' 
  | 'tour_completed' 
  | 'tour_cancelled'
  | 'tour_no_show'
  | 'email_sent' 
  | 'sms_sent' 
  | 'call_made' 
  | 'tour_booked'
  | 'workflow_started'
  | 'workflow_stopped'
  | 'lead_created'

// GET - Fetch activities for a lead
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = createRequestContext(request, '/api/leads/[id]/activities')
  ctx.logStart()
  const { id: leadId } = await params
  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    ctx.logSuccess(401, { reason: 'unauthorized' })
    return unauthorized(ctx.responseHeaders)
  }

  const supabase = createServiceClient()

  try {
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('property_id')
      .eq('id', leadId)
      .single()

    if (leadError || !lead) {
      ctx.logSuccess(404, { reason: 'lead_not_found', leadId })
      return notFound('Lead', ctx.responseHeaders)
    }

    const leadPropertyId = lead.property_id
    if (!leadPropertyId) {
      ctx.logSuccess(404, { reason: 'property_not_found', leadId })
      return notFound('Property', ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, leadPropertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', leadId, propertyId: lead.property_id })
      return forbidden(ctx.responseHeaders)
    }

    // Fetch activities with creator info
    const { data: activities, error } = await supabase
      .from('lead_activities')
      .select(`
        *,
        created_by_user:created_by (
          id,
          full_name
        )
      `)
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      ctx.logError(500, error, { operation: 'fetch_lead_activities', leadId })
      return serverError(error, ctx.responseHeaders)
    }

    ctx.logSuccess(200, {
      leadId,
      activityCount: activities?.length || 0,
    })

    return NextResponse.json(
      { activities: activities || [] },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'fetch_lead_activities' })
    return serverError(error, ctx.responseHeaders)
  }
}

// POST - Create a new activity (e.g., add a note)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = createRequestContext(request, '/api/leads/[id]/activities')
  ctx.logStart()
  const { id: leadId } = await params
  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    ctx.logSuccess(401, { reason: 'unauthorized' })
    return unauthorized(ctx.responseHeaders)
  }

  const supabase = createServiceClient()

  try {
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('property_id')
      .eq('id', leadId)
      .single()

    if (leadError || !lead) {
      ctx.logSuccess(404, { reason: 'lead_not_found', leadId })
      return notFound('Lead', ctx.responseHeaders)
    }

    const leadPropertyId = lead.property_id
    if (!leadPropertyId) {
      ctx.logSuccess(404, { reason: 'property_not_found', leadId })
      return notFound('Property', ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, leadPropertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', leadId, propertyId: lead.property_id })
      return forbidden(ctx.responseHeaders)
    }

    const body = await request.json()
    const { type, description, metadata } = body

    // Validation
    if (!type || !description) {
      ctx.logSuccess(400, { reason: 'missing_type_or_description', leadId })
      return badRequest('Type and description are required', ctx.responseHeaders)
    }

    const validTypes: ActivityType[] = [
      'note', 
      'status_change', 
      'tour_scheduled', 
      'tour_completed', 
      'tour_cancelled',
      'tour_no_show',
      'email_sent', 
      'sms_sent', 
      'call_made', 
      'tour_booked',
      'workflow_started',
      'workflow_stopped',
      'lead_created'
    ]

    if (!validTypes.includes(type)) {
      ctx.logSuccess(400, { reason: 'invalid_activity_type', leadId, type })
      return badRequest('Invalid activity type', ctx.responseHeaders)
    }

    // Create activity
    const { data: activity, error: activityError } = await supabase
      .from('lead_activities')
      .insert({
        lead_id: leadId,
        type,
        description,
        metadata: metadata || null,
        created_by: user.id,
      })
      .select(`
        *,
        created_by_user:created_by (
          id,
          full_name
        )
      `)
      .single()

    if (activityError) {
      ctx.logError(500, activityError, { operation: 'create_lead_activity', leadId })
      return serverError(activityError, ctx.responseHeaders)
    }

    ctx.logSuccess(201, {
      leadId,
      activityId: activity.id,
      activityType: type,
    })

    return NextResponse.json(
      { activity },
      { status: 201, headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'create_lead_activity' })
    return serverError(error, ctx.responseHeaders)
  }
}

