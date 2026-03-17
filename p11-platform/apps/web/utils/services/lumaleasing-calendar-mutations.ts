import { createServiceClient } from '@/utils/supabase/admin'
import {
  buildTourEventDateTimes,
  ensureCalendarWatch,
  getCalendarConfig,
  type CalendarConfig,
  getCalendarEvent,
} from '@/utils/services/google-calendar'

type BookingRow = {
  id: string
  lead_id: string
  scheduled_date: string
  scheduled_time: string
  property_id?: string
  status: string | null
}

type CalendarEventRow = {
  id: string
  tour_booking_id: string | null
  google_event_id: string
  sync_status: string | null
}

type CalendarMutationStatus = 'healthy' | 'external_drift' | 'external_missing' | 'external_cancelled'

export type CalendarMutationSummary = {
  propertyId: string
  checked: number
  healthy: number
  drifted: number
  missing: number
  cancelled: number
}

export class CalendarMutationIngestError extends Error {
  code: 'calendar_not_connected' | 'calendar_not_healthy'

  constructor(code: CalendarMutationIngestError['code'], message: string) {
    super(message)
    this.code = code
  }
}

function toHourMinute(time: string): string {
  return time.split(':').slice(0, 2).join(':')
}

function formatRemoteStartForBooking(
  remoteStartDateTime: string,
  timeZone: string
): { scheduledDate: string; scheduledTime: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = formatter.formatToParts(new Date(remoteStartDateTime))
  const lookup = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', string>

  return {
    scheduledDate: `${lookup.year}-${lookup.month}-${lookup.day}`,
    scheduledTime: `${lookup.hour}:${lookup.minute}:${lookup.second}`,
  }
}

function determineMutationStatus(args: {
  remoteEvent: Awaited<ReturnType<typeof getCalendarEvent>>
  expectedStartDateTime: string
  expectedEndDateTime: string
}): CalendarMutationStatus {
  if (!args.remoteEvent) {
    return 'external_missing'
  }

  if (args.remoteEvent.status === 'cancelled') {
    return 'external_cancelled'
  }

  if (
    args.remoteEvent.startDateTime !== args.expectedStartDateTime ||
    args.remoteEvent.endDateTime !== args.expectedEndDateTime
  ) {
    return 'external_drift'
  }

  return 'healthy'
}

async function updateLeadStatusAfterBookingCancellation(
  supabase: ReturnType<typeof createServiceClient>,
  leadId: string
) {
  const nowIso = new Date().toISOString()
  const [
    { data: otherTours, error: otherToursError },
    { data: otherBookings, error: otherBookingsError },
  ] = await Promise.all([
    supabase.from('tours').select('id').eq('lead_id', leadId).in('status', ['scheduled', 'confirmed']),
    supabase.from('tour_bookings').select('id').eq('lead_id', leadId).in('status', ['scheduled', 'confirmed']),
  ])

  if (otherToursError) {
    throw otherToursError
  }

  if (otherBookingsError) {
    throw otherBookingsError
  }

  if ((!otherTours || otherTours.length === 0) && (!otherBookings || otherBookings.length === 0)) {
    const { error: leadUpdateError } = await supabase
      .from('leads')
      .update({ status: 'contacted', updated_at: nowIso })
      .eq('id', leadId)

    if (leadUpdateError) {
      throw leadUpdateError
    }
  }
}

async function applyExternalMutationToBooking(args: {
  supabase: ReturnType<typeof createServiceClient>
  booking: BookingRow
  eventRow: CalendarEventRow
  remoteEvent: Awaited<ReturnType<typeof getCalendarEvent>>
  mutationStatus: Exclude<CalendarMutationStatus, 'healthy'>
  calendarConfig: CalendarConfig
  expectedTimes: { startLocalDateTime: string; endLocalDateTime: string }
}) {
  const { supabase, booking, eventRow, remoteEvent, mutationStatus, calendarConfig, expectedTimes } = args
  const nowIso = new Date().toISOString()

  if (mutationStatus === 'external_drift') {
    if (!remoteEvent?.startDateTime) {
      throw new Error('Remote calendar event is missing a start time')
    }

    const nextSchedule = formatRemoteStartForBooking(
      remoteEvent.startDateTime,
      calendarConfig.timezone
    )

    const { error: bookingUpdateError } = await supabase
      .from('tour_bookings')
      .update({
        scheduled_date: nextSchedule.scheduledDate,
        scheduled_time: nextSchedule.scheduledTime,
        updated_at: nowIso,
      })
      .eq('id', booking.id)

    if (bookingUpdateError) {
      throw bookingUpdateError
    }

    const { error: calendarEventUpdateError } = await supabase
      .from('calendar_events')
      .update({
        sync_status: 'synced',
        last_synced_at: nowIso,
      })
      .eq('id', eventRow.id)

    if (calendarEventUpdateError) {
      throw calendarEventUpdateError
    }

    const { error: leadActivityError } = await supabase.from('lead_activities').insert({
      lead_id: booking.lead_id,
      type: 'calendar_external_change_applied',
      description: `Booking ${booking.id} was rescheduled from Google Calendar`,
      metadata: {
        booking_id: booking.id,
        google_event_id: eventRow.google_event_id,
        mutation_status: mutationStatus,
        previous_date: booking.scheduled_date,
        previous_time: booking.scheduled_time,
        next_date: nextSchedule.scheduledDate,
        next_time: nextSchedule.scheduledTime,
        expected_start: expectedTimes.startLocalDateTime,
        expected_end: expectedTimes.endLocalDateTime,
        remote_start: remoteEvent.startDateTime,
        remote_end: remoteEvent.endDateTime || null,
      },
    })

    if (leadActivityError) {
      throw leadActivityError
    }
    return
  }

  const { error: bookingCancelError } = await supabase
    .from('tour_bookings')
    .update({
      status: 'cancelled',
      updated_at: nowIso,
    })
    .eq('id', booking.id)

  if (bookingCancelError) {
    throw bookingCancelError
  }

  const { error: calendarEventUpdateError } = await supabase
    .from('calendar_events')
    .update({
      sync_status: 'synced',
      last_synced_at: nowIso,
    })
    .eq('id', eventRow.id)

  if (calendarEventUpdateError) {
    throw calendarEventUpdateError
  }

  const { error: leadActivityError } = await supabase.from('lead_activities').insert({
    lead_id: booking.lead_id,
    type: 'calendar_external_change_applied',
    description: `Booking ${booking.id} was cancelled from Google Calendar`,
    metadata: {
      booking_id: booking.id,
      google_event_id: eventRow.google_event_id,
      mutation_status: mutationStatus,
      previous_date: booking.scheduled_date,
      previous_time: booking.scheduled_time,
      remote_status: remoteEvent?.status || null,
    },
  })

  if (leadActivityError) {
    throw leadActivityError
  }

  await updateLeadStatusAfterBookingCancellation(supabase, booking.lead_id)
}

export async function ingestExternalCalendarMutationsForProperty(
  propertyId: string
): Promise<CalendarMutationSummary> {
  const calendarConfig = await getCalendarConfig(propertyId)
  if (!calendarConfig) {
    throw new CalendarMutationIngestError('calendar_not_connected', 'Google Calendar not connected')
  }

  if (calendarConfig.token_status !== 'healthy') {
    throw new CalendarMutationIngestError(
      'calendar_not_healthy',
      'Google Calendar must be healthy before ingesting external mutations'
    )
  }

  try {
    await ensureCalendarWatch(calendarConfig)
  } catch (watchError) {
    console.error('[LumaLeasing Calendar] Failed to ensure Google Calendar watch:', watchError)
  }

  const supabase = createServiceClient()
  const { data: bookings, error: bookingsError } = await supabase
    .from('tour_bookings')
    .select('id, property_id, lead_id, scheduled_date, scheduled_time, status')
    .eq('property_id', propertyId)
    .in('status', ['scheduled', 'confirmed'])
    .limit(1000)

  if (bookingsError) {
    throw bookingsError
  }

  const activeBookings = (bookings || []) as BookingRow[]
  if (activeBookings.length === 0) {
    return {
      propertyId,
      checked: 0,
      healthy: 0,
      drifted: 0,
      missing: 0,
      cancelled: 0,
    }
  }

  const bookingIds = activeBookings.map(booking => booking.id)
  const bookingById = new Map(activeBookings.map(booking => [booking.id, booking]))
  const { data: calendarEvents, error: eventsError } = await supabase
    .from('calendar_events')
    .select('id, tour_booking_id, google_event_id, sync_status')
    .in('tour_booking_id', bookingIds)

  if (eventsError) {
    throw eventsError
  }

  let checked = 0
  let healthy = 0
  let drifted = 0
  let missing = 0
  let cancelled = 0

  for (const eventRow of (calendarEvents || []) as CalendarEventRow[]) {
    if (!eventRow.tour_booking_id) {
      continue
    }

    const booking = bookingById.get(eventRow.tour_booking_id)
    if (!booking) {
      continue
    }

    checked += 1
    const expectedTimes = buildTourEventDateTimes(
      calendarConfig,
      booking.scheduled_date,
      toHourMinute(booking.scheduled_time)
    )
    const remoteEvent = await getCalendarEvent(calendarConfig, eventRow.google_event_id)
    const mutationStatus = determineMutationStatus({
      remoteEvent,
      expectedStartDateTime: expectedTimes.startLocalDateTime,
      expectedEndDateTime: expectedTimes.endLocalDateTime,
    })

    if (mutationStatus === 'healthy') {
      healthy += 1
      if (eventRow.sync_status !== 'synced') {
        const { error: syncedUpdateError } = await supabase
          .from('calendar_events')
          .update({
            sync_status: 'synced',
            last_synced_at: new Date().toISOString(),
          })
          .eq('id', eventRow.id)

        if (syncedUpdateError) {
          throw syncedUpdateError
        }
      }
      continue
    }

    if (mutationStatus === 'external_drift') {
      drifted += 1
    } else if (mutationStatus === 'external_missing') {
      missing += 1
    } else if (mutationStatus === 'external_cancelled') {
      cancelled += 1
    }

    await applyExternalMutationToBooking({
      supabase,
      booking,
      eventRow,
      remoteEvent,
      mutationStatus,
      calendarConfig,
      expectedTimes,
    })
  }

  return {
    propertyId,
    checked,
    healthy,
    drifted,
    missing,
    cancelled,
  }
}
