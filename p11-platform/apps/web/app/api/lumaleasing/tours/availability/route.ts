import { admitLumaRead } from '@/utils/services/luma-public-read'
/**
 * LumaLeasing Tour Availability API
 * Returns available tour slots from Property Manager's Google Calendar
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { getCalendarConfig, fetchBusyTimes, generateAvailableSlots, type AvailableSlot } from '@/utils/services/google-calendar'
import {addCalendarDays, calendarDayRange, calendarToday, validCalendarDay} from '@/utils/services/calendar-time'
import { createRequestContext } from '@/utils/services/request-context'
import { getRateLimitKey, publicReadLimiter, rateLimitHeaders } from '@/utils/services/rate-limiter'
import {
  badRequest,
  buildCorsHeaders,
  corsPreflightResponse,
  rateLimited,
} from '@/utils/services/api-helpers'

function extractApiKey(req: NextRequest): string | null {
  const headerKey = req.headers.get('X-API-Key') || req.headers.get('x-api-key')
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
  const authKey = authHeader?.replace(/^Bearer\s+/i, '')
  const urlKey = new URL(req.url).searchParams.get('apiKey') || new URL(req.url).searchParams.get('api_key')

  const raw = headerKey || authKey || urlKey
  if (!raw) return null

  const normalized = raw.trim()
  return normalized.length ? normalized : null
}

const MAX_AVAILABILITY_RANGE_DAYS = 31

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin')
  return corsPreflightResponse(origin, 'GET, OPTIONS')
}

export async function GET(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/lumaleasing/tours/availability')
  ctx.logStart()
  const origin = req.headers.get('origin')
  const corsHeaders = buildCorsHeaders(origin, 'GET, OPTIONS')
  const responseHeaders = { ...corsHeaders, ...ctx.responseHeaders }
  try {
    const rlKey = getRateLimitKey(req, 'lumaleasing-tours-availability')
    const rl = publicReadLimiter.check(rlKey)
    if (!rl.allowed) {
      ctx.logSuccess(429, { reason: 'rate_limited' })
      return rateLimited({ ...responseHeaders, ...rateLimitHeaders(rl) })
    }

    const apiKey = extractApiKey(req)
    const { searchParams } = new URL(req.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!apiKey) {
      ctx.logSuccess(401, { reason: 'missing_api_key' })
      return NextResponse.json(
        { error: 'API key required' },
        { status: 401, headers: responseHeaders }
      )
    }

    const supabase = createServiceClient()

    // Validate API key and get property
    const { data: config, error: configError } = await supabase
      .from('lumaleasing_config')
      .select('property_id, tours_enabled')
      .eq('api_key', apiKey)
      .eq('is_active', true)
      .single()

    if (configError || !config || !config.tours_enabled) {
      ctx.logSuccess(404, { reason: 'tours_unavailable' })
      return NextResponse.json(
        { error: 'Tours not available for this property' },
        { status: 404, headers: responseHeaders }
      )
    }

    const propertyId = config.property_id
    if (!propertyId) {
      ctx.logSuccess(404, { reason: 'property_not_found' })
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404, headers: responseHeaders }
      )
    }

    const denied = await admitLumaRead(supabase,req,propertyId,responseHeaders)
    if(denied) return denied

    // Get Google Calendar configuration
    const calendarConfig = await getCalendarConfig(propertyId)

    if (!calendarConfig) {
      ctx.logSuccess(503, { reason: 'calendar_not_connected', propertyId })
      return NextResponse.json(
        { 
          error: 'Google Calendar not connected', 
          fallback: true,
          message: 'Property manager has not connected their calendar yet. Please call to schedule.' 
        },
        { status: 503, headers: responseHeaders }
      )
    }

    // Check token health
    if (calendarConfig.token_status !== 'healthy') {
      ctx.logSuccess(503, { reason: 'calendar_unhealthy', propertyId })
      return NextResponse.json(
        { 
          error: 'Calendar authorization expired', 
          fallback: true,
          message: 'Tour booking is temporarily unavailable. Please call to schedule.' 
        },
        { status: 503, headers: responseHeaders }
      )
    }

    if ((startDate && !validCalendarDay(startDate)) || (endDate && !validCalendarDay(endDate))) {
      return badRequest('Invalid startDate or endDate', responseHeaders)
    }
    const first = startDate || calendarToday(calendarConfig.timezone)
    const last = endDate || addCalendarDays(first, 13)
    if (first > last) return badRequest('startDate must be on or before endDate', responseHeaders)
    const rangeDays = (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86400000 + 1
    if (rangeDays > MAX_AVAILABILITY_RANGE_DAYS) return badRequest(`Date range cannot exceed ${MAX_AVAILABILITY_RANGE_DAYS} days`, responseHeaders)
    const range = calendarDayRange(first, last, calendarConfig.timezone)
    // Include padding on both sides so a neighboring event's buffer is respected.
    const buffer = calendarConfig.buffer_minutes * 60000
    const busyTimes = await fetchBusyTimes(calendarConfig, new Date(range.start.getTime() - buffer), new Date(range.end.getTime() + buffer))
    const slotsByDate: Record<string, AvailableSlot[]> = {}
    const availableDates: string[] = []
    for (let day = first; day <= last; day = addCalendarDays(day, 1)) {
      const slots = generateAvailableSlots(day, calendarConfig, busyTimes)
      if (slots.some(slot => slot.available)) {
        slotsByDate[day] = slots
        availableDates.push(day)
      }
    }

    ctx.logSuccess(200, {
      propertyId,
      availableDateCount: availableDates.length,
    })

    return NextResponse.json({
      success: true,
      availableDates,
      slotsByDate,
      timezone: calendarConfig.timezone,
      tourDuration: calendarConfig.tour_duration_minutes,
      bufferMinutes: calendarConfig.buffer_minutes,
    }, { headers: responseHeaders })

  } catch (error) {
    ctx.logError(500, error, { operation: 'fetch_tour_availability' })

    return NextResponse.json({error: 'Tour availability could not be verified', fallback: true,
      message: 'Tour booking is temporarily unavailable. Please try again or contact the property.'},
      {status: 503, headers: responseHeaders})
  }
}
