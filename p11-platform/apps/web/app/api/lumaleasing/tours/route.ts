import { admitLumaRead } from '@/utils/services/luma-public-read'
import {
badRequest,
buildCorsHeaders,
corsPreflightResponse,
rateLimited,
serverError,
} from '@/utils/services/api-helpers';
import { auditLog,getRequestIp } from '@/utils/services/audit-logger';
import {
fetchBusyTimes,
generateAvailableSlots,
getCalendarConfig
} from '@/utils/services/google-calendar';
import { upsertLeadByContact } from '@/utils/services/lead-upsert';
import { withLumaRequest } from '@/utils/services/luma-requests';
import { bookLumaLeasingTour } from '@/utils/services/lumaleasing-tour-booking';
import { formatPropertyAddress } from '@/utils/services/property-address';
import { getRateLimitKey,rateLimitHeaders,tourLimiter } from '@/utils/services/rate-limiter';
import { createRequestContext } from '@/utils/services/request-context';
import { tourBookingSchema,validateBody } from '@/utils/services/validation';
import { isWidgetSessionExpired } from '@/utils/services/widget-session';
import { createServiceClient } from '@/utils/supabase/admin';
import {calendarDateTimeInstant, calendarDayRange} from '@/utils/services/calendar-time';
import { NextRequest,NextResponse } from 'next/server';

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

    const denied = await admitLumaRead(supabase,req,propertyId,responseHeaders)
    if(denied) return denied

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
  return withLumaRequest(req, 'tours', handlePost)
}

async function handlePost(req: NextRequest) {
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
    let validatedConversationId: string | null = null;
    if (sessionId) {
      const { data: session, error: sessionError } = await supabase
        .from('widget_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('property_id', propertyId)
        .maybeSingle()

      if (sessionError) throw sessionError;
      if (!session) {
        ctx.logSuccess(400, { reason: 'invalid_session_id', sessionId, propertyId })
        return badRequest('Invalid sessionId for this property', responseHeaders)
      }
      if (isWidgetSessionExpired(session)) {
        return NextResponse.json({ error: 'Session expired', code: 'session_expired' }, { status: 410, headers: responseHeaders });
      }
    }

    if (conversationId) {
      const { data: conversation, error: conversationError } = await supabase
        .from('conversations')
        .select('id, widget_session_id')
        .eq('id', conversationId)
        .eq('property_id', propertyId)
        .maybeSingle()

      if (conversationError) throw conversationError;
      if (!conversation || (sessionId && conversation.widget_session_id !== sessionId)) {
        ctx.logSuccess(400, { reason: 'invalid_conversation_id', conversationId, propertyId })
        return badRequest('Invalid conversationId for this property', responseHeaders)
      }

      validatedConversationId = conversation.id
    }

    let configuredTourDuration = config.tour_duration_minutes || 30

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

      const instant = calendarDateTimeInstant(`${bookingDate}T${bookingTime}:00`, calendarConfig.timezone)
      if (!instant || Date.parse(instant) <= Date.now()) return badRequest('Tour time is in the past, invalid or ambiguous', responseHeaders)
      configuredTourDuration = calendarConfig.tour_duration_minutes
      const range = calendarDayRange(bookingDate, bookingDate, calendarConfig.timezone)
      const padding = calendarConfig.buffer_minutes * 60000
      const busyTimes = await fetchBusyTimes(calendarConfig, new Date(range.start.getTime() - padding), new Date(range.end.getTime() + padding))
      const availableSlots = generateAvailableSlots(bookingDate, calendarConfig, busyTimes)
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

    const repeatIntent = [
      `Tour requested for ${bookingDate} at ${bookingTime}`,
      effectiveSpecialRequests
        ? `Special requests: ${effectiveSpecialRequests}`
        : null,
    ].filter(Boolean).join('. ');
    const leadResult = await upsertLeadByContact({
      client: supabase,
      propertyId,
      email: leadInfo.email,
      phone: leadInfo.phone,
      create: {
        first_name: leadInfo.first_name || '',
        last_name: leadInfo.last_name || '',
        email: leadInfo.email,
        phone: leadInfo.phone || '',
        source: 'LumaLeasing Tour Booking',
        status: 'tour_booked',
        notes: effectiveSpecialRequests || null,
      },
      update: {
        ...(leadInfo.first_name ? { first_name: leadInfo.first_name } : {}),
        ...(leadInfo.last_name ? { last_name: leadInfo.last_name } : {}),
        email: leadInfo.email,
        ...(leadInfo.phone ? { phone: leadInfo.phone } : {}),
        status: 'tour_booked',
        ...(effectiveSpecialRequests ? { notes: effectiveSpecialRequests } : {}),
      },
      repeatActivity: {
        description: `Returned via LumaLeasing Tour Booking: ${repeatIntent}`,
        metadata: {
          source: 'lumaleasing_tour_widget',
          tourDate: bookingDate,
          tourTime: bookingTime,
          specialRequests: effectiveSpecialRequests,
        },
      },
    });
    const leadId = leadResult.leadId;

    if (sessionId) {
      const linked = await supabase.from('widget_sessions').update({lead_id:leadId,converted_at:new Date().toISOString()}).eq('id',sessionId).eq('property_id',propertyId).select('id').single()
      if (linked.error || !linked.data) throw new Error('Could not confirm session contact link')
    }
    if (validatedConversationId) {
      const linked = await supabase.from('conversations').update({lead_id:leadId}).eq('id',validatedConversationId).eq('property_id',propertyId).select('id').single()
      if (linked.error || !linked.data) throw new Error('Could not confirm conversation contact link')
    }
    const result = await bookLumaLeasingTour({supabase,propertyId,propertyName,propertyAddress,
      leadId,leadInfo,bookingDate,bookingTime,durationMinutes:configuredTourDuration,
      specialRequests:effectiveSpecialRequests,source:'lumaleasing',conversationId:validatedConversationId,
      slot,skipAvailabilityCheck:true})
    if (!result.ok) return NextResponse.json({error:result.message},{status:409,headers:responseHeaders})
    return NextResponse.json({success:true,duplicate:result.duplicate,
      booking:{id:result.booking.id,date:result.booking.scheduled_date,time:result.booking.scheduled_time,status:result.booking.status},
      calendar:result.calendar,confirmationStatus:'pending',message:result.message},{headers:responseHeaders})

  } catch (error) {
    ctx.logError(500, error, { operation: 'book_tour' })
    return serverError(error, responseHeaders);
  }
}
