// New tour booking write paths must go through `bookLumaLeasingTour`
// in `utils/services/lumaleasing-tour-booking.ts`. This file's POST handler
// retains its inline logic only because it is the public widget entry
// point with rich availability/slot semantics; the shared service is now
// the canonical write surface used by chat extraction and any future
// LumaLeasing booking surface so they stay in lockstep on validation,
// calendar sync, and confirmation email behavior.

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/admin';
import { generateTourCalendarResponse } from '@/utils/services/calendar-invite';
import { sendEmail, EmailAttachment } from '@/utils/services/messaging';
import {
  getCalendarConfig,
  createCalendarEvent,
  fetchBusyTimes,
  generateAvailableSlots,
} from '@/utils/services/google-calendar';
import { startWorkflow } from '@/utils/services/workflow-processor';
import { trackEngagementEvent } from '@/utils/services/engagement-tracker';
import { tourLimiter, getRateLimitKey, rateLimitHeaders } from '@/utils/services/rate-limiter';
import {
  badRequest,
  buildCorsHeaders,
  corsPreflightResponse,
  serverError,
  rateLimited,
} from '@/utils/services/api-helpers';
import { auditLog, getRequestIp } from '@/utils/services/audit-logger';
import { createRequestContext } from '@/utils/services/request-context';
import { formatPropertyAddress } from '@/utils/services/property-address';
import { tourBookingSchema, validateBody } from '@/utils/services/validation';
import { endOfDay, parseISO, startOfDay } from 'date-fns';

type TourSlotRow = {
  id: string
  slot_date: string
  start_time: string
  end_time: string
  max_bookings: number | null
  current_bookings: number | null
}

function extractApiKey(req: NextRequest): string | null {
  const headerKey = req.headers.get('X-API-Key') || req.headers.get('x-api-key');
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  const authKey = authHeader?.replace(/^Bearer\s+/i, '');
  const urlKey = new URL(req.url).searchParams.get('apiKey') || new URL(req.url).searchParams.get('api_key');

  const raw = headerKey || authKey || urlKey;
  if (!raw) return null;

  const normalized = raw.trim();
  return normalized.length ? normalized : null;
}

function normalizeLeadInfo(leadInfo: {
  firstName?: string
  first_name?: string
  lastName?: string
  last_name?: string
  email: string
  phone?: string
  notes?: string
}) {
  return {
    first_name: leadInfo.first_name || leadInfo.firstName || '',
    last_name: leadInfo.last_name || leadInfo.lastName || '',
    email: leadInfo.email,
    phone: leadInfo.phone || '',
    notes: leadInfo.notes,
  }
}

// Handle CORS preflight — origin-restricted in production
export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin')
  return corsPreflightResponse(origin, 'GET, POST, OPTIONS')
}

// GET - Fetch available tour slots
export async function GET(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/lumaleasing/tours')
  ctx.logStart()
  const origin = req.headers.get('origin')
  const corsHeaders = buildCorsHeaders(origin, 'GET, POST, OPTIONS')
  const responseHeaders = { ...corsHeaders, ...ctx.responseHeaders }

  try {
    // Rate limit
    const rlKey = getRateLimitKey(req, 'tours-get')
    const rl = tourLimiter.check(rlKey)
    if (!rl.allowed) {
      ctx.logSuccess(429, { reason: 'rate_limited', mode: 'get' })
      return rateLimited({ ...responseHeaders, ...rateLimitHeaders(rl) })
    }

    const apiKey = extractApiKey(req);
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!apiKey) {
      ctx.logSuccess(401, { reason: 'missing_api_key', mode: 'get' })
      return NextResponse.json(
        { error: 'API key required' },
        { status: 401, headers: responseHeaders }
      );
    }

    const supabase = createServiceClient();

    // Validate API key and get property
    const { data: config } = await supabase
      .from('lumaleasing_config')
      .select('property_id, tours_enabled, tour_duration_minutes')
      .eq('api_key', apiKey)
      .eq('is_active', true)
      .single();

    if (!config || !config.tours_enabled) {
      ctx.logSuccess(404, { reason: 'tours_not_available', mode: 'get' })
      return NextResponse.json(
        { error: 'Tours not available' },
        { status: 404, headers: responseHeaders }
      );
    }

    if (!config.property_id) {
      ctx.logSuccess(404, { reason: 'property_not_found', mode: 'get' })
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404, headers: responseHeaders }
      );
    }

    const propertyId = config.property_id

    // Default to next 14 days
    const start = startDate || new Date().toISOString().split('T')[0];
    const end = endDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Fetch available slots
    const { data: slots, error } = await supabase
      .from('tour_slots')
      .select('id, slot_date, start_time, end_time, max_bookings, current_bookings')
      .eq('property_id', propertyId)
      .eq('is_available', true)
      .gte('slot_date', start)
      .lte('slot_date', end)
      .order('slot_date', { ascending: true })
      .order('start_time', { ascending: true });

    if (error) {
      ctx.logError(500, error, { operation: 'fetch_tour_slots' })
      return NextResponse.json(
        { error: 'Failed to fetch slots' },
        { status: 500, headers: responseHeaders }
      );
    }

    // Filter out fully booked slots and format response
    const availableSlots = ((slots || []) as TourSlotRow[])
      .filter(slot => (slot.current_bookings || 0) < (slot.max_bookings || 0))
      .map(slot => ({
        id: slot.id,
        date: slot.slot_date,
        startTime: slot.start_time,
        endTime: slot.end_time,
        available: (slot.max_bookings || 0) - (slot.current_bookings || 0),
      }));

    // Group by date for easier frontend consumption
    const groupedSlots: Record<string, typeof availableSlots> = {};
    availableSlots.forEach(slot => {
      if (!groupedSlots[slot.date]) {
        groupedSlots[slot.date] = [];
      }
      groupedSlots[slot.date].push(slot);
    });

    ctx.logSuccess(200, {
      mode: 'get',
      slotCount: availableSlots.length,
      propertyId,
    })

    return NextResponse.json({
      slots: groupedSlots,
      tourDuration: config.tour_duration_minutes,
    }, { headers: responseHeaders });

  } catch (error) {
    ctx.logError(500, error, { operation: 'fetch_tour_slots' })
    return serverError(error, responseHeaders);
  }
}

// POST - Book a tour
export async function POST(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/lumaleasing/tours')
  ctx.logStart()
  const origin = req.headers.get('origin')
  const corsHeaders = buildCorsHeaders(origin, 'GET, POST, OPTIONS')
  const responseHeaders = { ...corsHeaders, ...ctx.responseHeaders }

  try {
    // Rate limit — 10 per minute per IP (prevents spam bookings)
    const rlKey = getRateLimitKey(req, 'tours-post')
    const rl = tourLimiter.check(rlKey)
    if (!rl.allowed) {
      auditLog({ eventType: 'rate_limit_exceeded', ip: getRequestIp(req), resource: 'lumaleasing/tours' })
      ctx.logSuccess(429, { reason: 'rate_limited', mode: 'post' })
      return rateLimited({ ...responseHeaders, ...rateLimitHeaders(rl) })
    }

    const apiKey = extractApiKey(req);

    if (!apiKey) {
      ctx.logSuccess(401, { reason: 'missing_api_key', mode: 'post' })
      return NextResponse.json(
        { error: 'API key required' },
        { status: 401, headers: responseHeaders }
      );
    }

    const rawBody = await req.json();
    const validation = validateBody(rawBody, tourBookingSchema)
    if (!validation.success) {
      ctx.logSuccess(400, { reason: 'invalid_request_body', mode: 'post' })
      return badRequest(validation.error, responseHeaders)
    }

    const {
      slotId,
      date,
      time,
      tourDate,
      tourTime,
      leadInfo: rawLeadInfo,
      specialRequests,
      notes,
      sessionId,
      conversationId,
    } = validation.data
    const leadInfo = normalizeLeadInfo(rawLeadInfo)
    const effectiveTourDate = tourDate || date || null
    const effectiveTourTime = tourTime || time || null
    const effectiveSpecialRequests = specialRequests || notes || leadInfo.notes || null

    const supabase = createServiceClient();

    // Validate API key and get property info
    const { data: config } = await supabase
      .from('lumaleasing_config')
      .select(`
        property_id, 
        tours_enabled,
        tour_duration_minutes,
        properties(
          id,
          name,
          address,
          website_url
        )
      `)
      .eq('api_key', apiKey)
      .eq('is_active', true)
      .single();

    if (!config || !config.tours_enabled) {
      ctx.logSuccess(404, { reason: 'tours_not_available', mode: 'post' })
      return NextResponse.json(
        { error: 'Tours not available' },
        { status: 404, headers: responseHeaders }
      );
    }

    if (!config.property_id) {
      ctx.logSuccess(404, { reason: 'property_not_found', mode: 'post' })
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404, headers: responseHeaders }
      );
    }

    const propertyId = config.property_id
    const configuredTourDuration = config.tour_duration_minutes || 30

    // Extract property info
    const propertyData = config.properties ? (Array.isArray(config.properties) ? config.properties[0] : config.properties) : null
    const property: { 
      id: string
      name: string
      address?: unknown
      website_url?: string 
    } | null = propertyData || null;
    const propertyName = property?.name || 'Property Tour';
    const propertyAddress = formatPropertyAddress(property?.address);

    // Get slot info (if slot-based booking) or use direct date/time
    let slot: TourSlotRow | null = null;
    let bookingDate = effectiveTourDate;
    let bookingTime = effectiveTourTime;
    let validatedConversationId: string | null = null;
    
    if (slotId) {
      // Slot-based booking (legacy method)
      const { data: slotData } = await supabase
        .from('tour_slots')
        .select('*')
        .eq('id', slotId)
        .eq('property_id', propertyId)
        .eq('is_available', true)
        .single();

      const typedSlotData = slotData as TourSlotRow | null

      if (!typedSlotData || (typedSlotData.current_bookings || 0) >= (typedSlotData.max_bookings || 0)) {
        ctx.logSuccess(409, { reason: 'slot_unavailable', slotId })
        return NextResponse.json(
          { error: 'This time slot is no longer available' },
          { status: 409, headers: responseHeaders }
        );
      }
      
      slot = typedSlotData;
      bookingDate = slot.slot_date;
      bookingTime = slot.start_time;
    } else {
      // Direct date/time booking (calendar widget)
      if (!bookingDate || !bookingTime) {
        ctx.logSuccess(400, { reason: 'missing_slot_or_datetime', mode: 'post' })
        return badRequest('Either slotId or tourDate+tourTime are required', responseHeaders)
      }

      // Validate date is not in the past
      const tourDateTime = new Date(`${bookingDate}T${bookingTime}:00`);
      if (tourDateTime < new Date()) {
        ctx.logSuccess(400, { reason: 'tour_in_past', bookingDate, bookingTime })
        return NextResponse.json(
          { error: 'Cannot book tours in the past' },
          { status: 400, headers: responseHeaders }
        );
      }

      const calendarConfig = await getCalendarConfig(propertyId)
      if (!calendarConfig) {
        ctx.logSuccess(503, { reason: 'calendar_not_connected', propertyId, mode: 'post' })
        return NextResponse.json(
          {
            error: 'Google Calendar not connected',
            fallback: true,
            message: 'Property manager has not connected their calendar yet. Please call to schedule.',
          },
          { status: 503, headers: responseHeaders }
        )
      }

      if (calendarConfig.token_status !== 'healthy') {
        ctx.logSuccess(503, { reason: 'calendar_unhealthy', propertyId, mode: 'post' })
        return NextResponse.json(
          {
            error: 'Calendar authorization expired',
            fallback: true,
            message: 'Tour booking is temporarily unavailable. Please call to schedule.',
          },
          { status: 503, headers: responseHeaders }
        )
      }

      const targetDate = parseISO(bookingDate)
      const busyTimes = await fetchBusyTimes(
        calendarConfig,
        startOfDay(targetDate),
        endOfDay(targetDate)
      )
      const availableSlots = generateAvailableSlots(
        startOfDay(targetDate),
        calendarConfig,
        busyTimes
      )
      const selectedSlot = availableSlots.find(
        (availableSlot) => availableSlot.time === bookingTime
      )

      if (!selectedSlot?.available) {
        ctx.logSuccess(409, {
          reason: 'direct_time_unavailable',
          propertyId,
          bookingDate,
          bookingTime,
        })
        return NextResponse.json(
          { error: 'This time is no longer available' },
          { status: 409, headers: responseHeaders }
        )
      }
    }

    if (sessionId) {
      const { data: session } = await supabase
        .from('widget_sessions')
        .select('id')
        .eq('id', sessionId)
        .eq('property_id', propertyId)
        .maybeSingle()

      if (!session) {
        ctx.logSuccess(400, { reason: 'invalid_session_id', sessionId, propertyId })
        return badRequest('Invalid sessionId for this property', responseHeaders)
      }
    }

    if (conversationId) {
      const { data: conversation } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversationId)
        .eq('property_id', propertyId)
        .maybeSingle()

      if (!conversation) {
        ctx.logSuccess(400, { reason: 'invalid_conversation_id', conversationId, propertyId })
        return badRequest('Invalid conversationId for this property', responseHeaders)
      }

      validatedConversationId = conversation.id
    }

    // Get or create lead
    let leadId: string | null = null;

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id')
      .eq('property_id', propertyId)
      .eq('email', leadInfo.email)
      .single();

    if (existingLead) {
      leadId = existingLead.id;
      // Update lead info if provided
      await supabase
        .from('leads')
        .update({
          first_name: leadInfo.first_name || undefined,
          last_name: leadInfo.last_name || undefined,
          phone: leadInfo.phone || undefined,
          status: 'tour_booked',
        })
        .eq('id', leadId);
    } else {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          property_id: propertyId,
          first_name: leadInfo.first_name || '',
          last_name: leadInfo.last_name || '',
          email: leadInfo.email,
          phone: leadInfo.phone || '',
          source: 'LumaLeasing Tour Booking',
          status: 'tour_booked',
        })
        .select('id')
        .single();

      leadId = newLead?.id || null;

      // Start follow-up workflow for new leads (non-blocking)
      if (leadId) {
        startWorkflow(leadId, propertyId, 'lead_created').catch(e =>
          console.error('[LumaLeasing Tours] Workflow start failed (non-blocking):', e)
        )
      }
    }

    if (!leadId) {
      ctx.logError(500, 'Failed to create lead', { operation: 'book_tour' })
      return NextResponse.json(
        { error: 'Failed to create lead' },
        { status: 500, headers: responseHeaders }
      );
    }

    const { data: existingBooking } = await supabase
      .from('tour_bookings')
      .select('id, scheduled_date, scheduled_time, status, duration_minutes')
      .eq('property_id', propertyId)
      .eq('lead_id', leadId)
      .eq('scheduled_date', bookingDate)
      .eq('scheduled_time', bookingTime)
      .in('status', ['scheduled', 'confirmed'])
      .maybeSingle()

    if (existingBooking) {
      const duplicateCalendarResponse = generateTourCalendarResponse({
        propertyName,
        propertyAddress,
        tourDate: existingBooking.scheduled_date,
        tourTime: existingBooking.scheduled_time,
        tourType: 'in_person',
        durationMinutes: existingBooking.duration_minutes || configuredTourDuration,
        prospectName: `${leadInfo.first_name || ''} ${leadInfo.last_name || ''}`.trim() || 'Guest',
        prospectEmail: leadInfo.email,
        propertyEmail: process.env.RESEND_FROM_EMAIL,
        specialRequests: effectiveSpecialRequests || undefined,
      });

      ctx.logSuccess(200, {
        mode: 'post',
        bookingId: existingBooking.id,
        propertyId,
        leadId,
        duplicate: true,
      })

      return NextResponse.json({
        success: true,
        duplicate: true,
        booking: {
          id: existingBooking.id,
          date: existingBooking.scheduled_date,
          time: existingBooking.scheduled_time,
          status: existingBooking.status,
        },
        calendar: {
          google: duplicateCalendarResponse.calendarLinks.google,
          outlook: duplicateCalendarResponse.calendarLinks.outlook,
          office365: duplicateCalendarResponse.calendarLinks.office365,
          yahoo: duplicateCalendarResponse.calendarLinks.yahoo,
          icsDownload: duplicateCalendarResponse.calendarLinks.icsDownload,
        },
        message: `This tour was already confirmed for ${formatDate(existingBooking.scheduled_date)} at ${formatTime(existingBooking.scheduled_time)}.`,
      }, { headers: responseHeaders });
    }

    // Update session with lead if provided
    if (sessionId) {
      await supabase
        .from('widget_sessions')
        .update({ lead_id: leadId, converted_at: new Date().toISOString() })
        .eq('id', sessionId)
        .eq('property_id', propertyId);
    }

    if (validatedConversationId) {
      await supabase
        .from('conversations')
        .update({ lead_id: leadId })
        .eq('id', validatedConversationId)
        .eq('property_id', propertyId);
    }

    // Create booking
    const { data: booking, error: bookingError } = await supabase
      .from('tour_bookings')
      .insert({
        property_id: propertyId,
        lead_id: leadId,
        slot_id: slotId || null,
        scheduled_date: bookingDate,
        scheduled_time: bookingTime,
        duration_minutes: slot ? 
          (new Date(`1970-01-01T${slot.end_time}Z`).getTime() - new Date(`1970-01-01T${slot.start_time}Z`).getTime()) / 60000 :
          configuredTourDuration,
        special_requests: effectiveSpecialRequests || null,
        source: 'lumaleasing',
        booked_via_conversation_id: validatedConversationId,
        status: 'confirmed',
      })
      .select()
      .single();

    if (bookingError) {
      ctx.logError(500, bookingError, { operation: 'create_booking', leadId })
      return NextResponse.json(
        { error: 'Failed to create booking' },
        { status: 500, headers: responseHeaders }
      );
    }

    // Increment slot booking count (only if slot-based booking)
    if (slotId && slot) {
      await supabase
        .from('tour_slots')
        .update({ current_bookings: (slot.current_bookings || 0) + 1 })
        .eq('id', slotId);
    }

    // Create activity on lead
    await supabase
      .from('lead_activities')
      .insert({
        lead_id: leadId,
        type: 'tour_booked',
        description: `Tour booked for ${bookingDate} at ${bookingTime}`,
        metadata: { booking_id: booking.id },
      });

    // Track tour_scheduled engagement event (non-blocking)
    trackEngagementEvent({
      leadId,
      propertyId,
      eventType: 'tour_scheduled',
      metadata: { booking_id: booking.id, source: 'lumaleasing_tour_widget' },
    }).catch(e => console.error('[LumaLeasing Tours] Engagement tracking failed (non-blocking):', e))

    // Generate calendar response (Calendly-style)
    const durationMinutes = booking.duration_minutes || 30;

    const calendarResponse = generateTourCalendarResponse({
      propertyName,
      propertyAddress,
      tourDate: booking.scheduled_date,
      tourTime: booking.scheduled_time,
      tourType: 'in_person', // Default to in-person for widget bookings
      durationMinutes,
      prospectName: `${leadInfo.first_name || ''} ${leadInfo.last_name || ''}`.trim() || 'Guest',
      prospectEmail: leadInfo.email,
      propertyEmail: process.env.RESEND_FROM_EMAIL,
      specialRequests: effectiveSpecialRequests || undefined
    });

    // Create Google Calendar event (if calendar connected)
    try {
      const calendarConfig = await getCalendarConfig(propertyId)
      
      if (calendarConfig && calendarConfig.token_status === 'healthy') {
        console.log(`[LumaLeasing Tours] Creating Google Calendar event for booking ${booking.id}`)
        
        const calendarEvent = await createCalendarEvent(calendarConfig, {
          propertyName,
          prospectName: `${leadInfo.first_name || ''} ${leadInfo.last_name || ''}`.trim() || 'Guest',
          prospectEmail: leadInfo.email,
          prospectPhone: leadInfo.phone,
          tourDate: booking.scheduled_date,
          tourTime: booking.scheduled_time.substring(0, 5), // Convert HH:MM:SS to HH:MM
          specialRequests: effectiveSpecialRequests || undefined,
          propertyAddress,
        })

        // Store event ID for two-way sync
        const { error: calendarEventStoreError } = await supabase
          .from('calendar_events')
          .insert({
            agent_calendar_id: calendarConfig.id,
            tour_booking_id: booking.id,
            google_event_id: calendarEvent.eventId,
            provider_event_id: calendarEvent.eventId,
            provider_event_link: calendarEvent.htmlLink || null,
            sync_status: 'synced',
            last_synced_at: new Date().toISOString(),
          })

        if (calendarEventStoreError) {
          console.error(
            `[LumaLeasing Tours] ⚠️ Failed to store calendar sync row for booking ${booking.id}:`,
            calendarEventStoreError
          )
        }

        console.log(`[LumaLeasing Tours] ✅ Created Google Calendar event: ${calendarEvent.eventId}`)
      } else {
        console.log(`[LumaLeasing Tours] ⚠️ Google Calendar not connected or unhealthy, skipping event creation`)
      }
    } catch (calendarError) {
      // Calendar event creation is non-blocking - don't fail the booking
      console.error(`[LumaLeasing Tours] ⚠️ Google Calendar event creation failed (non-blocking):`, calendarError)
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        type: 'calendar_sync_failed',
        description: `Google Calendar sync failed for booking ${booking.id}`,
        metadata: {
          booking_id: booking.id,
          reason: calendarError instanceof Error ? calendarError.message : 'unknown_error',
        },
      })
    }

    // Send confirmation email with .ics calendar attachment
    const emailSubject = `Your Tour at ${propertyName} is Confirmed! 📅`;
    const emailBody = buildConfirmationEmail(
      leadInfo.first_name || 'there',
      propertyName,
      formatDate(booking.scheduled_date),
      formatTime(booking.scheduled_time),
      propertyAddress
    );

    const attachments: EmailAttachment[] = [{
      filename: calendarResponse.icsAttachment.filename,
      content: calendarResponse.icsAttachment.content,
      contentType: calendarResponse.icsAttachment.contentType
    }];

    // Send email asynchronously (don't block response)
    sendEmail(
      leadInfo.email,
      emailSubject,
      emailBody.text,
      undefined,
      emailBody.html,
      attachments
    ).then(result => {
      if (result.success) {
        console.log(`[LumaLeasing Tours] ✅ Confirmation email sent to ${leadInfo.email}`);
      } else {
        console.error(`[LumaLeasing Tours] ❌ Failed to send email: ${result.error}`);
      }
    }).catch(err => {
      console.error('[LumaLeasing Tours] Email error:', err);
    });

    ctx.logSuccess(200, {
      mode: 'post',
      bookingId: booking.id,
      propertyId,
      leadId,
    })

    return NextResponse.json({
      success: true,
      booking: {
        id: booking.id,
        date: booking.scheduled_date,
        time: booking.scheduled_time,
        status: booking.status,
      },
      // Calendly-style calendar links for "Add to Calendar" buttons
      calendar: {
        google: calendarResponse.calendarLinks.google,
        outlook: calendarResponse.calendarLinks.outlook,
        office365: calendarResponse.calendarLinks.office365,
        yahoo: calendarResponse.calendarLinks.yahoo,
        icsDownload: calendarResponse.calendarLinks.icsDownload,
      },
      message: `Great! Your tour is confirmed for ${formatDate(booking.scheduled_date)} at ${formatTime(booking.scheduled_time)}. We've sent a confirmation with a calendar invite to ${leadInfo.email}.`,
    }, { headers: responseHeaders });

  } catch (error) {
    ctx.logError(500, error, { operation: 'book_tour' })
    return serverError(error, responseHeaders);
  }
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatTime(timeStr: string): string {
  const [hours, minutes] = timeStr.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

function buildConfirmationEmail(
  firstName: string,
  propertyName: string,
  tourDate: string,
  tourTime: string,
  propertyAddress?: string
): { text: string; html: string } {
  const text = `Hi ${firstName}!

Your tour at ${propertyName} is confirmed! 🎉

📅 Date: ${tourDate}
🕐 Time: ${tourTime}
${propertyAddress ? `📍 Address: ${propertyAddress}` : ''}

We've attached a calendar invite to this email - just open it to add this tour to your calendar!

When you arrive, check in at the leasing office and we'll take care of the rest.

Need to reschedule? Just reply to this email.

See you soon!
The ${propertyName} Team`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
      
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 32px; text-align: center;">
        <h1 style="margin: 0; color: white; font-size: 24px; font-weight: 600;">Tour Confirmed! 🎉</h1>
      </div>
      
      <!-- Content -->
      <div style="padding: 32px;">
        <p style="margin: 0 0 24px; font-size: 16px; color: #374151; line-height: 1.6;">
          Hi ${firstName}!
        </p>
        
        <p style="margin: 0 0 24px; font-size: 16px; color: #374151; line-height: 1.6;">
          Your tour at <strong>${propertyName}</strong> is all set!
        </p>
        
        <!-- Tour Details Card -->
        <div style="background: #f9fafb; border-radius: 12px; padding: 24px; margin: 0 0 24px;">
          <div style="display: flex; align-items: center; margin-bottom: 12px;">
            <span style="font-size: 20px; margin-right: 12px;">📅</span>
            <span style="font-size: 18px; font-weight: 600; color: #111827;">${tourDate}</span>
          </div>
          <div style="display: flex; align-items: center; margin-bottom: ${propertyAddress ? '12px' : '0'};">
            <span style="font-size: 20px; margin-right: 12px;">🕐</span>
            <span style="font-size: 18px; font-weight: 600; color: #111827;">${tourTime}</span>
          </div>
          ${propertyAddress ? `
          <div style="display: flex; align-items: center;">
            <span style="font-size: 20px; margin-right: 12px;">📍</span>
            <span style="font-size: 16px; color: #4b5563;">${propertyAddress}</span>
          </div>
          ` : ''}
        </div>
        
        <!-- Calendar Reminder -->
        <div style="background: #fef3c7; border-radius: 8px; padding: 16px; margin: 0 0 24px;">
          <p style="margin: 0; font-size: 14px; color: #92400e;">
            <strong>📎 Calendar Invite Attached!</strong><br>
            Open the attached .ics file to add this tour to your calendar automatically.
          </p>
        </div>
        
        <p style="margin: 0 0 16px; font-size: 16px; color: #374151; line-height: 1.6;">
          When you arrive, just check in at the leasing office and we'll take care of the rest.
        </p>
        
        <p style="margin: 0 0 24px; font-size: 14px; color: #6b7280;">
          Need to reschedule? Just reply to this email.
        </p>
        
        <p style="margin: 0; font-size: 16px; color: #374151;">
          See you soon!<br>
          <strong>The ${propertyName} Team</strong>
        </p>
      </div>
      
    </div>
    
    <!-- Footer -->
    <div style="text-align: center; padding: 24px;">
      <p style="margin: 0; font-size: 12px; color: #9ca3af;">
        Powered by P11 Concierge
      </p>
    </div>
  </div>
</body>
</html>`;  return { text, html };
}