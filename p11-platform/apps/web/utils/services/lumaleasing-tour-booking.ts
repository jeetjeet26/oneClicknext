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

import { endOfDay, parseISO, startOfDay } from 'date-fns'

import type { createServiceClient } from '@/utils/supabase/admin'
import { sendEmail, type EmailAttachment } from '@/utils/services/messaging'
import { trackEngagementEvent } from '@/utils/services/engagement-tracker'
import {
  type CalendarConfig,
  createCalendarEvent,
  fetchBusyTimes,
  generateAvailableSlots,
  getCalendarConfig,
} from '@/utils/services/google-calendar'
import {
  generateTourCalendarResponse,
  type CalendarLinks,
} from '@/utils/services/calendar-invite'

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

function buildConfirmationEmail(
  firstName: string,
  propertyName: string,
  tourDate: string,
  tourTime: string,
  propertyAddress?: string
): { text: string; html: string } {
  const text = `Hi ${firstName}!

Your tour at ${propertyName} is confirmed!

Date: ${tourDate}
Time: ${tourTime}
${propertyAddress ? `Address: ${propertyAddress}` : ''}

We've attached a calendar invite to this email.

Need to reschedule? Just reply to this email.

See you soon!
The ${propertyName} Team`

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f4f4f5;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
      <div style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:32px;text-align:center;">
        <h1 style="margin:0;color:white;font-size:24px;font-weight:600;">Tour Confirmed</h1>
      </div>
      <div style="padding:32px;">
        <p style="margin:0 0 24px;font-size:16px;color:#374151;line-height:1.6;">Hi ${firstName},</p>
        <p style="margin:0 0 24px;font-size:16px;color:#374151;line-height:1.6;">
          Your tour at <strong>${propertyName}</strong> is all set.
        </p>
        <div style="background:#f9fafb;border-radius:12px;padding:24px;margin:0 0 24px;">
          <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111827;">${tourDate}</p>
          <p style="margin:0 0 ${propertyAddress ? '8px' : '0'};font-size:18px;font-weight:600;color:#111827;">${tourTime}</p>
          ${propertyAddress ? `<p style="margin:0;font-size:16px;color:#4b5563;">${propertyAddress}</p>` : ''}
        </div>
        <p style="margin:0 0 16px;font-size:14px;color:#6b7280;">
          A calendar invite is attached. Need to reschedule? Reply to this email and we'll help.
        </p>
        <p style="margin:0;font-size:16px;color:#374151;">The ${propertyName} Team</p>
      </div>
    </div>
    <div style="text-align:center;padding:24px;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">Powered by P11 Concierge</p>
    </div>
  </div>
</body>
</html>`

  return { text, html }
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
} | null> {
  const { data } = await supabase
    .from('tour_bookings')
    .select('id, scheduled_date, scheduled_time, status, duration_minutes')
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
  const targetDate = parseISO(bookingDate)
  const busyTimes = await fetchBusyTimes(
    calendarConfig,
    startOfDay(targetDate),
    endOfDay(targetDate)
  )
  const slots = generateAvailableSlots(
    startOfDay(targetDate),
    calendarConfig,
    busyTimes
  )

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

    if (calendarConfig && calendarConfig.token_status !== 'healthy') {
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

  const durationMinutes =
    slotDuration ?? params.durationMinutes ?? DEFAULT_DURATION_MINUTES

  let bookingRow: BookLumaLeasingTourSuccess['booking']
  let isDuplicate = false

  if (existingBooking) {
    isDuplicate = true
    bookingRow = {
      id: existingBooking.id,
      scheduled_date: existingBooking.scheduled_date,
      scheduled_time: existingBooking.scheduled_time,
      status: existingBooking.status,
      duration_minutes:
        existingBooking.duration_minutes ?? durationMinutes,
    }
  } else {
    const { data: insertedBooking, error: bookingError } = await supabase
      .from('tour_bookings')
      .insert({
        property_id: propertyId,
        lead_id: leadId,
        slot_id: slot?.id ?? null,
        scheduled_date: bookingDate,
        scheduled_time: bookingTime,
        duration_minutes: durationMinutes,
        special_requests: specialRequests ?? null,
        source,
        booked_via_conversation_id: conversationId ?? null,
        status: 'confirmed',
      })
      .select('id, scheduled_date, scheduled_time, status, duration_minutes')
      .single()

    if (bookingError || !insertedBooking) {
      return {
        ok: false,
        reason: 'booking_insert_failed',
        message: 'Failed to create the tour booking.',
        detail: bookingError ?? null,
      }
    }

    bookingRow = {
      id: insertedBooking.id,
      scheduled_date: insertedBooking.scheduled_date,
      scheduled_time: insertedBooking.scheduled_time,
      status: insertedBooking.status,
      duration_minutes: insertedBooking.duration_minutes ?? durationMinutes,
    }

    if (slot?.id) {
      await supabase
        .from('tour_slots')
        .update({ current_bookings: (slot.current_bookings || 0) + 1 })
        .eq('id', slot.id)
    }

    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      type: 'tour_booked',
      description: `Tour booked for ${bookingDate} at ${bookingTime}`,
      metadata: { booking_id: bookingRow.id, source },
    })

    trackEngagementEvent({
      leadId,
      propertyId,
      eventType: 'tour_scheduled',
      metadata: { booking_id: bookingRow.id, source },
    }).catch((engagementError) =>
      console.error(
        '[LumaLeasingTourBooking] engagement tracking failed (non-blocking):',
        engagementError
      )
    )

    await supabase
      .from('leads')
      .update({ status: 'tour_booked' })
      .eq('id', leadId)

    // Re-score the lead now that a tour is booked. Failure must not block
    // confirmation; the next scheduled scoring run will catch this lead.
    try {
      const { data: scoreId } = await supabase.rpc('score_lead', {
        p_lead_id: leadId,
      })
      if (scoreId) {
        const { data: scoreData } = await supabase
          .from('lead_scores')
          .select('total_score, score_bucket')
          .eq('id', scoreId)
          .single()

        if (scoreData) {
          await supabase
            .from('leads')
            .update({
              score: scoreData.total_score,
              score_bucket: scoreData.score_bucket,
            })
            .eq('id', leadId)
        }
      }
    } catch (scoreError) {
      console.error(
        '[LumaLeasingTourBooking] lead rescoring failed (non-blocking):',
        scoreError
      )
    }
  }

  const calendarResponse = generateTourCalendarResponse({
    propertyName,
    propertyAddress,
    tourDate: bookingRow.scheduled_date,
    tourTime: bookingRow.scheduled_time,
    tourType: 'in_person',
    durationMinutes: bookingRow.duration_minutes,
    prospectName:
      `${leadInfo.first_name || ''} ${leadInfo.last_name || ''}`.trim() ||
      'Guest',
    prospectEmail: leadInfo.email,
    propertyEmail: process.env.RESEND_FROM_EMAIL,
    specialRequests: specialRequests || undefined,
  })

  let calendarEventId: string | null = null
  if (!isDuplicate) {
    if (!calendarConfig) {
      calendarConfig = await getCalendarConfig(propertyId)
    }

    if (calendarConfig && calendarConfig.token_status === 'healthy') {
      try {
        const event = await createCalendarEvent(calendarConfig, {
          propertyName,
          prospectName:
            `${leadInfo.first_name || ''} ${leadInfo.last_name || ''}`.trim() ||
            'Guest',
          prospectEmail: leadInfo.email,
          prospectPhone: leadInfo.phone ?? undefined,
          tourDate: bookingRow.scheduled_date,
          tourTime: bookingRow.scheduled_time.substring(0, 5),
          specialRequests: specialRequests || undefined,
          propertyAddress,
        })

        calendarEventId = event.eventId

        const { error: calendarEventStoreError } = await supabase
          .from('calendar_events')
          .insert({
            agent_calendar_id: calendarConfig.id,
            tour_booking_id: bookingRow.id,
            google_event_id: event.eventId,
            provider_event_id: event.eventId,
            provider_event_link: event.htmlLink || null,
            sync_status: 'synced',
            last_synced_at: new Date().toISOString(),
          })

        if (calendarEventStoreError) {
          console.error(
            '[LumaLeasingTourBooking] failed to persist calendar event mapping:',
            calendarEventStoreError
          )
        }
      } catch (calendarError) {
        console.error(
          '[LumaLeasingTourBooking] calendar event creation failed (non-blocking):',
          calendarError
        )

        await supabase.from('lead_activities').insert({
          lead_id: leadId,
          type: 'calendar_sync_failed',
          description: `Google Calendar sync failed for booking ${bookingRow.id}`,
          metadata: {
            booking_id: bookingRow.id,
            reason:
              calendarError instanceof Error
                ? calendarError.message
                : 'unknown_error',
          },
        })
      }
    }
  }

  // Send confirmation email asynchronously so the API response is fast and
  // mail provider hiccups do not fail the booking.
  if (!isDuplicate) {
    const attachments: EmailAttachment[] = [
      {
        filename: calendarResponse.icsAttachment.filename,
        content: calendarResponse.icsAttachment.content,
        contentType: calendarResponse.icsAttachment.contentType,
      },
    ]
    const { text, html } = buildConfirmationEmail(
      leadInfo.first_name || 'there',
      propertyName,
      formatDate(bookingRow.scheduled_date),
      formatTime(bookingRow.scheduled_time),
      propertyAddress
    )

    sendEmail(
      leadInfo.email,
      `Your Tour at ${propertyName} is Confirmed`,
      text,
      undefined,
      html,
      attachments
    )
      .then((result) => {
        if (!result.success) {
          console.error(
            '[LumaLeasingTourBooking] confirmation email failed:',
            result.error
          )
        }
      })
      .catch((emailError) =>
        console.error('[LumaLeasingTourBooking] email send error:', emailError)
      )
  }

  const message = isDuplicate
    ? `This tour was already confirmed for ${formatDate(bookingRow.scheduled_date)} at ${formatTime(bookingRow.scheduled_time)}.`
    : `Great! Your tour is confirmed for ${formatDate(bookingRow.scheduled_date)} at ${formatTime(bookingRow.scheduled_time)}. We've sent a confirmation with a calendar invite to ${leadInfo.email}.`

  return {
    ok: true,
    duplicate: isDuplicate,
    booking: bookingRow,
    calendar: calendarResponse.calendarLinks,
    calendarEventId,
    message,
  }
}
