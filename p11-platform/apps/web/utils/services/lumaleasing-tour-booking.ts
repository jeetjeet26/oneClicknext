import {tourCalendarDb} from './tour-calendar-db'
import type { Json } from '@/types/supabase'
import { phaseFourDb } from './phase-four-db'
/**
 * Shared LumaLeasing tour booking pipeline.
 *
 * This service is the single write path for tour bookings created through
 * LumaLeasing surfaces (the public tours POST endpoint and the chat
 * extraction flow). Centralizing the pipeline guarantees the same
 * availability validation, duplicate detection, audit-trail side effects,
 * Google Calendar event creation, and confirmation email behavior across
 * every entry point.
 */

import {calendarDateTimeInstant, calendarDayRange} from './calendar-time'

import {
generateTourCalendarResponse,
type CalendarLinks,
} from '@/utils/services/calendar-invite'
import {
fetchBusyTimes,
generateAvailableSlots,
getCalendarConfig,
type CalendarConfig
} from '@/utils/services/google-calendar'
import type { createServiceClient } from '@/utils/supabase/admin'

type ServiceClient = ReturnType<typeof createServiceClient>

export type TourBookingSource = 'lumaleasing' | 'lumaleasing_extraction'

export interface TourBookingLeadInfo {
  first_name?: string | null
  last_name?: string | null
  email: string
  phone?: string | null
}

export interface TourBookingSlot {
  id: string
  start_time: string
  end_time: string
  current_bookings: number | null
  max_bookings: number | null
}

export interface BookLumaLeasingTourParams {
  supabase: ServiceClient
  propertyId: string
  propertyName: string
  propertyAddress?: string
  leadId: string
  leadInfo: TourBookingLeadInfo
  bookingDate: string // YYYY-MM-DD
  bookingTime: string // HH:MM
  durationMinutes?: number
  specialRequests?: string | null
  source: TourBookingSource
  attributionMetadata?: Record<string, unknown>
  conversationId?: string | null
  slot?: TourBookingSlot | null
  /**
   * If true, skip availability validation against Google Calendar busy times.
   * The public tours POST sets this to false for direct bookings; chat
   * extraction may set it to true only when the booking originates from a
   * server-validated availability slot.
   */
  skipAvailabilityCheck?: boolean
  /** Optional pre-fetched calendar config to avoid an extra DB hit. */
  calendarConfig?: CalendarConfig | null
}

export interface BookLumaLeasingTourSuccess {
  ok: true
  duplicate: boolean
  booking: {
    id: string
    scheduled_date: string
    scheduled_time: string
    status: string | null
    duration_minutes: number
    schedule_timezone?: string | null
  }
  calendar: CalendarLinks
  calendarEventId: string | null
  message: string
}

export type BookLumaLeasingTourFailure = {
  ok: false
  reason:
    | 'time_unavailable'
    | 'calendar_unhealthy'
    | 'booking_insert_failed'
    | 'invalid_input'
  message: string
  detail?: unknown
}

export type BookLumaLeasingTourResult =
  | BookLumaLeasingTourSuccess
  | BookLumaLeasingTourFailure

const DEFAULT_DURATION_MINUTES = 30

function normalizeBookingTime(time: string): string {
  return time.split(':').slice(0, 2).join(':')
}

function formatDate(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`)
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function formatTime(timeStr: string): string {
  const [hours, minutes] = timeStr.split(':')
  const hour = parseInt(hours, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 || 12
  return `${hour12}:${minutes} ${ampm}`
}

async function findExistingBooking(
  supabase: ServiceClient,
  params: {
    propertyId: string
    leadId: string
    bookingDate: string
    bookingTime: string
  }
): Promise<{
  id: string
  scheduled_date: string
  scheduled_time: string
  status: string | null
  duration_minutes: number | null
  schedule_timezone?: string | null
} | null> {
  const { data } = await tourCalendarDb(supabase)
    .from('tour_bookings')
    .select('id, scheduled_date, scheduled_time, status, duration_minutes, schedule_timezone')
    .eq('property_id', params.propertyId)
    .eq('lead_id', params.leadId)
    .eq('scheduled_date', params.bookingDate)
    .eq('scheduled_time', params.bookingTime)
    .in('status', ['scheduled', 'confirmed'])
    .maybeSingle()

  return data ?? null
}

async function isTimeAvailable(
  calendarConfig: CalendarConfig,
  bookingDate: string,
  bookingTime: string
): Promise<boolean> {
  const range = calendarDayRange(bookingDate, bookingDate, calendarConfig.timezone)
  const padding = calendarConfig.buffer_minutes * 60000
  const busyTimes = await fetchBusyTimes(calendarConfig, new Date(range.start.getTime() - padding), new Date(range.end.getTime() + padding))
  const slots = generateAvailableSlots(bookingDate, calendarConfig, busyTimes)

  const normalized = normalizeBookingTime(bookingTime)
  const match = slots.find((slot) => slot.time === normalized)
  return Boolean(match?.available)
}

/**
 * Single canonical write path for LumaLeasing tour bookings. Both the public
 * tours POST handler and the chat extraction pipeline call this so we never
 * end up with off-calendar or unsynced bookings.
 */
export async function bookLumaLeasingTour(
  params: BookLumaLeasingTourParams
): Promise<BookLumaLeasingTourResult> {
  const {
    supabase,
    propertyId,
    propertyName,
    propertyAddress,
    leadId,
    leadInfo,
    bookingDate,
    specialRequests,
    source,
    conversationId,
    slot,
    skipAvailabilityCheck,
  } = params

  const bookingTime = normalizeBookingTime(params.bookingTime)
  const slotDuration = slot
    ? Math.max(
        1,
        (new Date(`1970-01-01T${slot.end_time}Z`).getTime() -
          new Date(`1970-01-01T${slot.start_time}Z`).getTime()) /
          60000
      )
    : null

  if (!leadInfo.email) {
    return {
      ok: false,
      reason: 'invalid_input',
      message: 'Lead email is required to book a tour.',
    }
  }

  // Reuse existing duplicate booking instead of inserting a second row.
  const existingBooking = await findExistingBooking(supabase, {
    propertyId,
    leadId,
    bookingDate,
    bookingTime,
  })

  let calendarConfig: CalendarConfig | null = params.calendarConfig ?? null
  if (calendarConfig === undefined) {
    calendarConfig = null
  }

  if (!skipAvailabilityCheck && !existingBooking) {
    if (!calendarConfig) {
      calendarConfig = await getCalendarConfig(propertyId)
    }

    if (!calendarConfig || calendarConfig.token_status !== 'healthy') {
      return {
        ok: false,
        reason: 'calendar_unhealthy',
        message:
          'Calendar authorization is not healthy. Tours cannot be booked until the property reconnects calendar.',
      }
    }

    if (calendarConfig && calendarConfig.token_status === 'healthy') {
      const available = await isTimeAvailable(
        calendarConfig,
        bookingDate,
        bookingTime
      )

      if (!available) {
        return {
          ok: false,
          reason: 'time_unavailable',
          message: `${formatDate(bookingDate)} at ${formatTime(bookingTime)} is no longer available.`,
        }
      }
    }
  }

  calendarConfig ??= await getCalendarConfig(propertyId)
  if (!calendarConfig || calendarConfig.token_status !== 'healthy') return {ok: false, reason: 'calendar_unhealthy', message: 'The property calendar needs to be reconnected.'}
  const durationMinutes = slotDuration ?? calendarConfig.tour_duration_minutes ?? params.durationMinutes ?? DEFAULT_DURATION_MINUTES
  const startsAt = calendarDateTimeInstant(`${bookingDate}T${bookingTime}:00`, calendarConfig.timezone)
  if (!startsAt || (!existingBooking && Date.parse(startsAt) <= Date.now())) return {ok: false, reason: 'invalid_input', message: 'The tour time is in the past, invalid or ambiguous. Please choose another time.'}

  const reservation = await phaseFourDb(supabase).rpc('reserve_luma_tour', {
    p_property_id:propertyId,p_lead_id:leadId,
    p_booking:{slot_id:slot?.id ?? null,scheduled_date:bookingDate,scheduled_time:bookingTime,
      duration_minutes:durationMinutes,special_requests:specialRequests ?? null,source,
      booked_via_conversation_id:conversationId ?? null},
    p_delivery:{propertyName,propertyAddress:propertyAddress ?? '',leadInfo,
      calendarId:calendarConfig.id,providerCalendarId:calendarConfig.calendar_id,provider:calendarConfig.provider,
      bookingDate,bookingTime,durationMinutes,timezone:calendarConfig.timezone,startsAt,
      specialRequests:specialRequests ?? null} as unknown as Json,
  })
  if (reservation.error || !reservation.data) return {ok:false,reason:'booking_insert_failed',
    message:'The tour could not be reserved. Please refresh the available times.',detail:reservation.error}
  const saved = reservation.data as unknown as {booking:BookLumaLeasingTourSuccess['booking'];duplicate:boolean}
  if (!saved.booking?.id) return {ok:false,reason:'booking_insert_failed',message:'Could not confirm the reservation.'}
  const bookingRow = saved.booking
  const isDuplicate = saved.duplicate

  const savedZone = bookingRow.schedule_timezone || existingBooking?.schedule_timezone || (!isDuplicate ? calendarConfig.timezone : null)
  const savedInstant = savedZone && calendarDateTimeInstant(`${bookingRow.scheduled_date}T${normalizeBookingTime(bookingRow.scheduled_time)}:00`, savedZone)
  if (!savedInstant) return {ok: false, reason: 'calendar_unhealthy', message: 'The existing reservation needs timezone review before calendar links can be confirmed.'}
  const calendarResponse = generateTourCalendarResponse({
    propertyName,
    propertyAddress,
    tourDate: bookingRow.scheduled_date,
    tourTime: bookingRow.scheduled_time,
    tourType: 'in_person',
    durationMinutes: bookingRow.duration_minutes,
    startsAt: savedInstant,
    uid: `tour-${bookingRow.id}@p11`,
    prospectName:
      `${leadInfo.first_name || ''} ${leadInfo.last_name || ''}`.trim() ||
      'Guest',
    prospectEmail: leadInfo.email,
    propertyEmail: process.env.RESEND_FROM_EMAIL,
    specialRequests: specialRequests || undefined,
  })

  // Calendar/email delivery is queued in the reservation transaction. The
  // visitor sees confirmed local reservation status, never an invented receipt.
  const calendarEventId = null
  const message = `Your tour is reserved for ${formatDate(bookingRow.scheduled_date)} at ${formatTime(bookingRow.scheduled_time)}. Calendar and email confirmation are pending.`

  return {
    ok: true,
    duplicate: isDuplicate,
    booking: bookingRow,
    calendar: calendarResponse.calendarLinks,
    calendarEventId,
    message,
  }
}
