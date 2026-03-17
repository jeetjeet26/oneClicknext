import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  badRequest,
  forbidden,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'
import {
  cancelCalendarEvent,
  createCalendarEvent,
  getCalendarConfig,
  updateCalendarEvent,
} from '@/utils/services/google-calendar'

const RecoveryActionSchema = z.object({
  propertyId: z.string().min(1),
  bookingId: z.string().min(1),
  action: z.enum(['cancel', 'reschedule']),
  rescheduleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  rescheduleTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  reason: z.string().max(500).optional(),
})

type RecoveryBookingRow = {
  id: string
  property_id: string | null
  lead_id: string | null
  scheduled_date: string
  scheduled_time: string
  duration_minutes: number | null
  status: string | null
  special_requests: string | null
}

type CalendarEventRow = {
  id: string
  google_event_id: string
  sync_status: string | null
}

type LeadRow = {
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
}

type PropertyRow = {
  name: string | null
  address: { street?: string; full?: string } | null
}

function normalizeAddress(property: PropertyRow | null): string | undefined {
  if (!property?.address || typeof property.address !== 'object') {
    return undefined
  }

  return property.address.street || property.address.full
}

function normalizeLeadName(lead: LeadRow | null): string {
  if (!lead) {
    return 'Guest'
  }
  const composed = `${lead.first_name || ''} ${lead.last_name || ''}`.trim()
  return composed || 'Guest'
}

function normalizeTimeForCalendar(timeValue: string): string {
  return timeValue.split(':').slice(0, 2).join(':')
}

function isRecoverableStatus(status: string | null): boolean {
  return status === 'scheduled' || status === 'confirmed'
}

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/lumaleasing/tours/recovery')
  ctx.logStart()

  try {
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      ctx.logSuccess(400, { reason: 'missing_property_id' })
      return badRequest('Property ID required', ctx.responseHeaders)
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', propertyId, userId: user.id })
      return forbidden(ctx.responseHeaders)
    }

    const serviceSupabase = createServiceClient()
    const [{ data: bookingRows, error: bookingError }, { data: calendarEventRows, error: calendarError }] =
      await Promise.all([
        serviceSupabase
          .from('tour_bookings')
          .select('id, property_id, lead_id, scheduled_date, scheduled_time, duration_minutes, status, special_requests')
          .eq('property_id', propertyId)
          .order('scheduled_date', { ascending: true })
          .order('scheduled_time', { ascending: true })
          .limit(100),
        serviceSupabase
          .from('calendar_events')
          .select('id, tour_booking_id, google_event_id, sync_status')
          .limit(1000),
      ])

    if (bookingError) {
      ctx.logError(500, bookingError, { operation: 'load_recovery_bookings', propertyId })
      return serverError(bookingError, ctx.responseHeaders)
    }
    if (calendarError) {
      ctx.logError(500, calendarError, { operation: 'load_recovery_calendar_events', propertyId })
      return serverError(calendarError, ctx.responseHeaders)
    }

    const bookings = (bookingRows || []) as RecoveryBookingRow[]
    const leadIds = Array.from(new Set(bookings.map((booking) => booking.lead_id).filter(Boolean))) as string[]

    const { data: leadRows, error: leadError } = leadIds.length
      ? await serviceSupabase
          .from('leads')
          .select('id, first_name, last_name, email, phone')
          .in('id', leadIds)
      : { data: [], error: null }

    if (leadError) {
      ctx.logError(500, leadError, { operation: 'load_recovery_leads', propertyId })
      return serverError(leadError, ctx.responseHeaders)
    }

    const leadById = new Map(
      ((leadRows || []) as Array<LeadRow & { id: string }>).map((lead) => [lead.id, lead])
    )
    const eventByBookingId = new Map(
      ((calendarEventRows || []) as Array<CalendarEventRow & { tour_booking_id: string | null }>)
        .filter((row): row is CalendarEventRow & { tour_booking_id: string } => Boolean(row.tour_booking_id))
        .map((row) => [row.tour_booking_id, row])
    )

    const recoverableBookings = bookings.map((booking) => {
      const lead = booking.lead_id ? leadById.get(booking.lead_id) || null : null
      const calendarEvent = eventByBookingId.get(booking.id) || null
      return {
        id: booking.id,
        lead: lead
          ? {
              name: normalizeLeadName(lead),
              email: lead.email,
              phone: lead.phone,
            }
          : null,
        scheduled_date: booking.scheduled_date,
        scheduled_time: booking.scheduled_time,
        duration_minutes: booking.duration_minutes,
        status: booking.status,
        special_requests: booking.special_requests,
        can_cancel: isRecoverableStatus(booking.status),
        can_reschedule: isRecoverableStatus(booking.status),
        calendar_event: calendarEvent
          ? {
              id: calendarEvent.id,
              google_event_id: calendarEvent.google_event_id,
              sync_status: calendarEvent.sync_status,
            }
          : null,
      }
    })

    ctx.logSuccess(200, {
      propertyId,
      bookingCount: recoverableBookings.length,
    })

    return NextResponse.json(
      {
        bookings: recoverableBookings,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'load_recovery_bookings' })
    return serverError(error, ctx.responseHeaders)
  }
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/lumaleasing/tours/recovery')
  ctx.logStart()

  try {
    const body = await request.json()
    const parsed = RecoveryActionSchema.safeParse(body)
    if (!parsed.success) {
      ctx.logSuccess(400, { reason: 'invalid_request_body' })
      return badRequest('Invalid recovery action payload', ctx.responseHeaders)
    }

    const { propertyId, bookingId, action, rescheduleDate, rescheduleTime, reason } = parsed.data

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', propertyId, userId: user.id })
      return forbidden(ctx.responseHeaders)
    }

    const serviceSupabase = createServiceClient()

    const [{ data: booking, error: bookingError }, { data: property, error: propertyError }] =
      await Promise.all([
        serviceSupabase
          .from('tour_bookings')
          .select('id, property_id, lead_id, scheduled_date, scheduled_time, duration_minutes, status, special_requests')
          .eq('id', bookingId)
          .eq('property_id', propertyId)
          .maybeSingle(),
        serviceSupabase.from('properties').select('name, address').eq('id', propertyId).maybeSingle(),
      ])

    if (bookingError || !booking) {
      ctx.logSuccess(400, { reason: 'booking_not_found', propertyId, bookingId })
      return badRequest('Booking not found for property', ctx.responseHeaders)
    }
    if (propertyError) {
      ctx.logError(500, propertyError, { operation: 'load_recovery_property', propertyId })
      return serverError(propertyError, ctx.responseHeaders)
    }

    const bookingRow = booking as RecoveryBookingRow
    if (!isRecoverableStatus(bookingRow.status)) {
      ctx.logSuccess(409, {
        reason: 'booking_not_recoverable',
        bookingId,
        status: bookingRow.status,
      })
      return NextResponse.json(
        { error: 'Only scheduled/confirmed bookings can be changed' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const { data: leadRow } = bookingRow.lead_id
      ? await serviceSupabase
          .from('leads')
          .select('first_name, last_name, email, phone')
          .eq('id', bookingRow.lead_id)
          .maybeSingle()
      : { data: null }

    const { data: calendarEvent } = await serviceSupabase
      .from('calendar_events')
      .select('id, google_event_id, sync_status')
      .eq('tour_booking_id', bookingId)
      .maybeSingle()

    const calendarConfig = await getCalendarConfig(propertyId)
    const nowIso = new Date().toISOString()

    if (action === 'cancel') {
      await serviceSupabase
        .from('tour_bookings')
        .update({
          status: 'cancelled',
          completion_notes: reason || 'Cancelled by operator from recovery panel',
          updated_at: nowIso,
        })
        .eq('id', bookingId)

      let calendarAction: 'skipped' | 'cancelled' | 'failed' = 'skipped'
      if (
        calendarEvent?.google_event_id &&
        calendarConfig &&
        calendarConfig.token_status === 'healthy'
      ) {
        try {
          await cancelCalendarEvent(calendarConfig, calendarEvent.google_event_id)
          calendarAction = 'cancelled'
        } catch {
          calendarAction = 'failed'
        }
      }

      if (calendarEvent?.id) {
        await serviceSupabase
          .from('calendar_events')
          .update({
            sync_status:
              calendarAction === 'failed'
                ? 'failed'
                : 'external_cancelled',
            last_synced_at: nowIso,
          })
          .eq('id', calendarEvent.id)
      }

      if (bookingRow.lead_id) {
        await serviceSupabase.from('lead_activities').insert({
          lead_id: bookingRow.lead_id,
          type: 'tour_cancelled',
          description: `Tour booking ${bookingId} cancelled by operator`,
          metadata: {
            booking_id: bookingId,
            previous_date: bookingRow.scheduled_date,
            previous_time: bookingRow.scheduled_time,
            reason: reason || null,
            calendar_action: calendarAction,
          },
        })
      }

      ctx.logSuccess(200, { propertyId, bookingId, action, calendarAction })
      return NextResponse.json(
        {
          success: true,
          bookingId,
          action,
          calendarAction,
        },
        { headers: ctx.responseHeaders }
      )
    }

    if (!rescheduleDate || !rescheduleTime) {
      ctx.logSuccess(400, { reason: 'missing_reschedule_datetime', bookingId })
      return badRequest('rescheduleDate and rescheduleTime are required', ctx.responseHeaders)
    }

    const nextStart = new Date(`${rescheduleDate}T${rescheduleTime}:00`)
    if (Number.isNaN(nextStart.getTime()) || nextStart <= new Date()) {
      ctx.logSuccess(400, { reason: 'invalid_reschedule_datetime', bookingId })
      return badRequest('Reschedule target must be a valid future date/time', ctx.responseHeaders)
    }

    await serviceSupabase
      .from('tour_bookings')
      .update({
        scheduled_date: rescheduleDate,
        scheduled_time: `${rescheduleTime}:00`,
        status: 'confirmed',
        updated_at: nowIso,
      })
      .eq('id', bookingId)

    let calendarAction: 'skipped' | 'updated' | 'created' | 'failed' = 'skipped'
    if (calendarConfig && calendarConfig.token_status === 'healthy' && leadRow?.email) {
      try {
        const propertyRow = (property || null) as PropertyRow | null
        const tourDetails = {
          propertyName: propertyRow?.name || 'Property Tour',
          prospectName: normalizeLeadName((leadRow || null) as LeadRow | null),
          prospectEmail: leadRow.email,
          prospectPhone: leadRow.phone || undefined,
          tourDate: rescheduleDate,
          tourTime: normalizeTimeForCalendar(rescheduleTime),
          specialRequests: bookingRow.special_requests || undefined,
          propertyAddress: normalizeAddress(propertyRow),
        }

        if (calendarEvent?.google_event_id) {
          await updateCalendarEvent(calendarConfig, calendarEvent.google_event_id, tourDetails)
          await serviceSupabase
            .from('calendar_events')
            .update({
              sync_status: 'synced',
              last_synced_at: nowIso,
            })
            .eq('id', calendarEvent.id)
          calendarAction = 'updated'
        } else {
          const created = await createCalendarEvent(calendarConfig, tourDetails)
          await serviceSupabase.from('calendar_events').insert({
            agent_calendar_id: calendarConfig.id,
            tour_booking_id: bookingId,
            google_event_id: created.eventId,
            sync_status: 'synced',
            last_synced_at: nowIso,
          })
          calendarAction = 'created'
        }
      } catch {
        calendarAction = 'failed'
        if (calendarEvent?.id) {
          await serviceSupabase
            .from('calendar_events')
            .update({
              sync_status: 'failed',
              last_synced_at: nowIso,
            })
            .eq('id', calendarEvent.id)
        }
      }
    }

    if (bookingRow.lead_id) {
      await serviceSupabase.from('lead_activities').insert({
        lead_id: bookingRow.lead_id,
        type: 'tour_rescheduled',
        description: `Tour booking ${bookingId} rescheduled by operator`,
        metadata: {
          booking_id: bookingId,
          previous_date: bookingRow.scheduled_date,
          previous_time: bookingRow.scheduled_time,
          next_date: rescheduleDate,
          next_time: `${rescheduleTime}:00`,
          reason: reason || null,
          calendar_action: calendarAction,
        },
      })
    }

    ctx.logSuccess(200, { propertyId, bookingId, action, calendarAction })
    return NextResponse.json(
      {
        success: true,
        bookingId,
        action,
        calendarAction,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'booking_recovery_action' })
    return serverError(error, ctx.responseHeaders)
  }
}
