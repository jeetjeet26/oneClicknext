import { createServiceClient } from '@/utils/supabase/admin'
import {
  createCalendarEvent,
  getCalendarConfig,
  updateCalendarEvent,
} from '@/utils/services/google-calendar'

type BookingRow = {
  id: string
  property_id: string
  lead_id: string
  scheduled_date: string
  scheduled_time: string
  special_requests: string | null
  status: string | null
}

type LeadRow = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
}

type CalendarEventRow = {
  id: string
  tour_booking_id: string | null
  google_event_id: string
  sync_status: string | null
}

type PropertyRow = {
  name: string | null
  address: { street?: string; full?: string } | null
}

export type CalendarReconcileFailure = {
  bookingId: string
  reason: string
}

export type CalendarReconcileSummary = {
  propertyId: string
  activeBookings: number
  created: number
  repaired: number
  alreadySynced: number
  skipped: number
  failed: number
  failures: CalendarReconcileFailure[]
}

export class CalendarReconcileError extends Error {
  code: 'calendar_not_connected' | 'calendar_not_healthy'

  constructor(code: CalendarReconcileError['code'], message: string) {
    super(message)
    this.code = code
  }
}

function toHourMinute(time: string): string {
  return time.split(':').slice(0, 2).join(':')
}

function normalizePropertyAddress(property: PropertyRow | null): string | undefined {
  if (!property?.address || typeof property.address !== 'object') {
    return undefined
  }

  return property.address.street || property.address.full
}

function buildProspectName(lead: LeadRow): string {
  const name = `${lead.first_name || ''} ${lead.last_name || ''}`.trim()
  return name || 'Guest'
}

function isCalendarEventNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('404')
}

export async function reconcileCalendarForProperty(
  propertyId: string
): Promise<CalendarReconcileSummary> {
  const calendarConfig = await getCalendarConfig(propertyId)
  if (!calendarConfig) {
    throw new CalendarReconcileError('calendar_not_connected', 'Google Calendar not connected')
  }

  if (calendarConfig.token_status !== 'healthy') {
    throw new CalendarReconcileError(
      'calendar_not_healthy',
      'Google Calendar must be healthy before reconciliation'
    )
  }

  const serviceSupabase = createServiceClient()
  const [
    { data: property, error: propertyError },
    { data: bookings, error: bookingsError },
    { data: calendarEvents, error: calendarEventsError },
  ] = await Promise.all([
    serviceSupabase.from('properties').select('name, address').eq('id', propertyId).maybeSingle(),
    serviceSupabase
      .from('tour_bookings')
      .select('id, property_id, lead_id, scheduled_date, scheduled_time, special_requests, status')
      .eq('property_id', propertyId)
      .in('status', ['scheduled', 'confirmed'])
      .limit(1000),
    serviceSupabase
      .from('calendar_events')
      .select('id, tour_booking_id, google_event_id, sync_status')
      .eq('agent_calendar_id', calendarConfig.id)
      .limit(1000),
  ])

  if (propertyError) {
    throw propertyError
  }
  if (bookingsError) {
    throw bookingsError
  }
  if (calendarEventsError) {
    throw calendarEventsError
  }

  const activeBookings = (bookings || []) as BookingRow[]
  const leadIds = Array.from(new Set(activeBookings.map(booking => booking.lead_id)))
  const { data: leads, error: leadsError } = leadIds.length
    ? await serviceSupabase
        .from('leads')
        .select('id, first_name, last_name, email, phone')
        .in('id', leadIds)
    : { data: [], error: null }

  if (leadsError) {
    throw leadsError
  }

  const leadById = new Map(((leads || []) as LeadRow[]).map(lead => [lead.id, lead]))
  const calendarEventByBookingId = new Map(
    ((calendarEvents || []) as CalendarEventRow[])
      .filter((event): event is CalendarEventRow & { tour_booking_id: string } =>
        typeof event.tour_booking_id === 'string' && event.tour_booking_id.length > 0
      )
      .map(event => [event.tour_booking_id, event])
  )

  const propertyName = property?.name || 'Property Tour'
  const propertyAddress = normalizePropertyAddress((property || null) as PropertyRow | null)
  const reconciledAt = new Date().toISOString()
  const failures: CalendarReconcileFailure[] = []
  let created = 0
  let repaired = 0
  let alreadySynced = 0
  let skipped = 0
  let failed = 0

  for (const booking of activeBookings) {
    const lead = leadById.get(booking.lead_id)
    const eventRow = calendarEventByBookingId.get(booking.id)

    if (!lead?.email) {
      skipped += 1
      failures.push({ bookingId: booking.id, reason: 'missing_lead_email' })
      continue
    }

    const tourDetails = {
      propertyName,
      prospectName: buildProspectName(lead),
      prospectEmail: lead.email,
      prospectPhone: lead.phone || undefined,
      tourDate: booking.scheduled_date,
      tourTime: toHourMinute(booking.scheduled_time),
      specialRequests: booking.special_requests || undefined,
      propertyAddress,
    }

    try {
      if (!eventRow || !eventRow.google_event_id) {
        const createdEvent = await createCalendarEvent(calendarConfig, tourDetails)
        if (eventRow?.id) {
          await serviceSupabase
            .from('calendar_events')
            .update({
              google_event_id: createdEvent.eventId,
              provider_event_id: createdEvent.eventId,
              provider_event_link: createdEvent.htmlLink || null,
              sync_status: 'synced',
              last_synced_at: reconciledAt,
            })
            .eq('id', eventRow.id)
        } else {
          await serviceSupabase.from('calendar_events').insert({
            agent_calendar_id: calendarConfig.id,
            tour_booking_id: booking.id,
            google_event_id: createdEvent.eventId,
            provider_event_id: createdEvent.eventId,
            provider_event_link: createdEvent.htmlLink || null,
            sync_status: 'synced',
            last_synced_at: reconciledAt,
          })
        }
        created += 1
        continue
      }

      if (eventRow.sync_status === 'synced') {
        alreadySynced += 1
        continue
      }

      try {
        await updateCalendarEvent(calendarConfig, eventRow.google_event_id, tourDetails)
      } catch (updateError) {
        if (!isCalendarEventNotFoundError(updateError)) {
          throw updateError
        }

        const recreatedEvent = await createCalendarEvent(calendarConfig, tourDetails)
        await serviceSupabase
          .from('calendar_events')
          .update({
            google_event_id: recreatedEvent.eventId,
            provider_event_id: recreatedEvent.eventId,
            provider_event_link: recreatedEvent.htmlLink || null,
            sync_status: 'synced',
            last_synced_at: reconciledAt,
          })
          .eq('id', eventRow.id)
        repaired += 1
        continue
      }

      await serviceSupabase
        .from('calendar_events')
        .update({
          sync_status: 'synced',
          last_synced_at: reconciledAt,
        })
        .eq('id', eventRow.id)
      repaired += 1
    } catch (reconcileError) {
      failed += 1
      failures.push({
        bookingId: booking.id,
        reason: reconcileError instanceof Error ? reconcileError.message : 'unknown_error',
      })
      if (eventRow?.id) {
        await serviceSupabase
          .from('calendar_events')
          .update({
            sync_status: 'failed',
            last_synced_at: reconciledAt,
          })
          .eq('id', eventRow.id)
      }
      await serviceSupabase.from('lead_activities').insert({
        lead_id: booking.lead_id,
        type: 'calendar_sync_failed',
        description: `Calendar reconciliation failed for booking ${booking.id}`,
        metadata: {
          booking_id: booking.id,
          google_event_id: eventRow?.google_event_id || null,
          reason: reconcileError instanceof Error ? reconcileError.message : 'unknown_error',
        },
      })
    }
  }

  return {
    propertyId,
    activeBookings: activeBookings.length,
    created,
    repaired,
    alreadySynced,
    skipped,
    failed,
    failures,
  }
}
