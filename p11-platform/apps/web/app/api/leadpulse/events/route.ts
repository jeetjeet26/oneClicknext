/**
 * LeadPulse Events API
 * Track engagement events that affect lead scores
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { EVENT_WEIGHTS, type EventType } from '@/utils/services/leadpulse-events'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  badRequest,
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'

// POST: Record an engagement event
export async function POST(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/leadpulse/events')
  ctx.logStart()

  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const body = await req.json()
    const { leadId, eventType, metadata, propertyId } = body

    if (!leadId || !eventType) {
      ctx.logSuccess(400, { reason: 'missing_lead_or_event_type' })
      return badRequest('leadId and eventType required', ctx.responseHeaders)
    }

    // Validate event type
    if (!Object.keys(EVENT_WEIGHTS).includes(eventType)) {
      ctx.logSuccess(400, { reason: 'invalid_event_type', eventType })
      return badRequest('Invalid eventType', ctx.responseHeaders)
    }

    const serviceClient = createServiceClient()

    // Verify lead exists and get property_id if not provided
    const { data: lead, error: leadError } = await serviceClient
      .from('leads')
      .select('id, property_id')
      .eq('id', leadId)
      .single()

    if (leadError || !lead) {
      ctx.logSuccess(404, { reason: 'lead_not_found', leadId })
      return notFound('Lead', ctx.responseHeaders)
    }

    const effectivePropertyId = propertyId || lead.property_id
    if (!effectivePropertyId) {
      ctx.logSuccess(404, { reason: 'property_not_found', leadId })
      return notFound('Property', ctx.responseHeaders)
    }
    const access = await validatePropertyAccess(user.id, effectivePropertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, {
        reason: 'forbidden',
        propertyId: effectivePropertyId,
        leadId,
      })
      return forbidden(ctx.responseHeaders)
    }

    // Insert event
    const { data: event, error: eventError } = await serviceClient
      .from('lead_engagement_events')
      .insert({
        lead_id: leadId,
        property_id: effectivePropertyId,
        event_type: eventType,
        metadata: metadata || {},
        score_weight: EVENT_WEIGHTS[eventType as EventType],
      })
      .select()
      .single()

    if (eventError) {
      ctx.logError(500, eventError, {
        operation: 'record_lead_event',
        leadId,
        eventType,
      })
      return serverError(eventError, ctx.responseHeaders)
    }

    // Optionally trigger rescore (can be async/queued in production)
    const { data: scoreId } = await serviceClient
      .rpc('score_lead', { p_lead_id: leadId })

    ctx.logSuccess(200, {
      leadId,
      eventType,
      eventId: event.id,
      rescored: !!scoreId,
    })

    return NextResponse.json(
      {
        success: true,
        event: {
          id: event.id,
          leadId: event.lead_id,
          eventType: event.event_type,
          scoreWeight: event.score_weight,
          createdAt: event.created_at,
        },
        rescored: !!scoreId,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'record_lead_event' })
    return serverError(error, ctx.responseHeaders)
  }
}

// GET: Get events for a lead
export async function GET(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/leadpulse/events')
  ctx.logStart()

  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const searchParams = req.nextUrl.searchParams
    const leadId = searchParams.get('leadId')
    const limit = parseInt(searchParams.get('limit') || '50')

    if (!leadId) {
      ctx.logSuccess(400, { reason: 'missing_lead_id' })
      return badRequest('leadId required', ctx.responseHeaders)
    }

    const serviceClient = createServiceClient()
    const { data: lead, error: leadError } = await serviceClient
      .from('leads')
      .select('property_id')
      .eq('id', leadId)
      .single()

    if (leadError || !lead) {
      ctx.logSuccess(404, { reason: 'lead_not_found', leadId })
      return notFound('Lead', ctx.responseHeaders)
    }

    if (!lead.property_id) {
      ctx.logSuccess(404, { reason: 'property_not_found', leadId })
      return notFound('Property', ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, lead.property_id)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', leadId, propertyId: lead.property_id })
      return forbidden(ctx.responseHeaders)
    }

    const { data: events, error } = await supabase
      .from('lead_engagement_events')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      ctx.logError(500, error, { operation: 'fetch_lead_events', leadId })
      return serverError(error, ctx.responseHeaders)
    }

    ctx.logSuccess(200, { leadId, eventCount: events.length })

    return NextResponse.json(
      {
        events: events.map(e => ({
          id: e.id,
          eventType: e.event_type,
          metadata: e.metadata,
          scoreWeight: e.score_weight,
          createdAt: e.created_at,
        })),
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'fetch_lead_events' })
    return serverError(error, ctx.responseHeaders)
  }
}



























