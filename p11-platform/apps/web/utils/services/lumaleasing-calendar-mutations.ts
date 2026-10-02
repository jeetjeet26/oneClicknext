import {tourCalendarDb} from './tour-calendar-db'
import type {Database,Json} from '@/types/supabase'
import type {SupabaseClient} from '@supabase/supabase-js'
import { calendarDateTimeInstant } from './calendar-time'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  buildTourEventDateTimes,
  ensureCalendarWatch,
  getCalendarConfig,
  getCalendarEvent,
} from '@/utils/services/google-calendar'

type ObservationDatabase=Omit<Database,'public'> & {public:Omit<Database['public'],'Functions'> & {Functions:Database['public']['Functions'] & {record_tour_calendar_observation:{Args:{p_property_id:string;p_calendar_id:string;p_event_id:string;p_booking_id:string;p_version:number;p_provider_event_id:string;p_read_started_at:string;p_status:string;p_remote:Json|null};Returns:string}}}}

type BookingRow = {
  schedule_timezone?: string | null
  schedule_version: number
  id: string
  lead_id: string
  scheduled_date: string
  scheduled_time: string
  property_id?: string
  status: string | null
  duration_minutes?: number
}

type CalendarEventRow = {
  id: string
  tour_booking_id: string | null
  google_event_id: string
  provider_event_id?: string
  agent_calendar_id?: string
  sync_status: string | null
}

type CalendarMutationStatus = 'healthy' | 'external_drift' | 'external_missing' | 'external_cancelled'

export type CalendarMutationSummary = {
  propertyId: string
  checked: number
  skipped: number
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

function determineMutationStatus(args: {
  remoteEvent: Awaited<ReturnType<typeof getCalendarEvent>>
  expectedStartDateTime: string
  expectedEndDateTime: string
  timezone: string
}): CalendarMutationStatus {
  if (!args.remoteEvent) {
    return 'external_missing'
  }

  if (args.remoteEvent.status === 'cancelled') {
    return 'external_cancelled'
  }

  const expectedStart=calendarDateTimeInstant(args.expectedStartDateTime,args.timezone),expectedEnd=calendarDateTimeInstant(args.expectedEndDateTime,args.timezone)
  if (!expectedStart || !expectedEnd ||
    args.remoteEvent.startDateTime !== expectedStart ||
    args.remoteEvent.endDateTime !== expectedEnd
  ) {
    return 'external_drift'
  }

  return 'healthy'
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
  const { data: bookings, error: bookingsError } = await tourCalendarDb(supabase)
    .from('tour_bookings')
    .select('id, property_id, lead_id, scheduled_date, scheduled_time, duration_minutes, schedule_timezone, status, schedule_version')
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
      skipped: 0,
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
    .select('id, tour_booking_id, google_event_id, provider_event_id, agent_calendar_id, sync_status')
    .in('tour_booking_id', bookingIds)

  if (eventsError) {
    throw eventsError
  }

  let skipped = 0
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
    if (!booking || (eventRow.agent_calendar_id && eventRow.agent_calendar_id!==calendarConfig.id) || eventRow.sync_status === 'pending') {
      continue
    }

    const expectedTimes = buildTourEventDateTimes(
      {...calendarConfig,timezone:booking.schedule_timezone||calendarConfig.timezone,tour_duration_minutes:booking.duration_minutes??calendarConfig.tour_duration_minutes},
      booking.scheduled_date,
      toHourMinute(booking.scheduled_time)
    )
    const readStartedAt=new Date().toISOString()
    const remoteEvent = await getCalendarEvent(calendarConfig, eventRow.provider_event_id||eventRow.google_event_id)
    const mutationStatus = determineMutationStatus({
      remoteEvent,
      expectedStartDateTime: expectedTimes.startInstant,
      expectedEndDateTime: expectedTimes.endInstant,
      timezone:booking.schedule_timezone||calendarConfig.timezone,
    })

    const recorded=await (supabase as unknown as SupabaseClient<ObservationDatabase>).rpc('record_tour_calendar_observation',{
      p_property_id:propertyId,p_calendar_id:calendarConfig.id,p_event_id:eventRow.id,p_booking_id:booking.id,p_version:booking.schedule_version,
      p_provider_event_id:eventRow.provider_event_id||eventRow.google_event_id,p_read_started_at:readStartedAt,p_status:mutationStatus==='healthy'?'synced':mutationStatus,
      p_remote:remoteEvent ? {id:remoteEvent.id,status:remoteEvent.status,startDateTime:remoteEvent.startDateTime,endDateTime:remoteEvent.endDateTime} : null,
    })
    if(recorded.error)throw recorded.error
    if(recorded.data==='stale'||recorded.data==='not_found'){skipped++;continue}
    if(recorded.data!=='recorded')throw new Error('Calendar observation was not confirmed')
    checked++
    if(mutationStatus==='healthy')healthy++
    else if(mutationStatus==='external_drift')drifted++
    else if(mutationStatus==='external_missing')missing++
    else if(mutationStatus==='external_cancelled')cancelled++

  }

  return {
    propertyId,
    checked,
    skipped,
    healthy,
    drifted,
    missing,
    cancelled,
  }
}
