/**
 * LumaLeasing Tour Availability API
 * Returns available tour slots from Property Manager's Google Calendar
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { getCalendarConfig, fetchBusyTimes, generateAvailableSlots, type AvailableSlot } from '@/utils/services/google-calendar'
import { addDays, startOfDay, endOfDay, format, isValid, parseISO } from 'date-fns'
import { createRequestContext } from '@/utils/services/request-context'
import { getRateLimitKey, publicReadLimiter, rateLimitHeaders } from '@/utils/services/rate-limiter'
import {
  badRequest,
  buildCorsHeaders,
  corsPreflightResponse,
  rateLimited,
  serverError,
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

function parseDateParam(value: string | null, fallback: Date, mode: 'start' | 'end'): Date {
  if (!value) {
    return fallback
  }

  const parsed = parseISO(value)
  if (!isValid(parsed)) {
    throw new Error(`Invalid ${mode}Date`)
  }

  return mode === 'start' ? startOfDay(parsed) : endOfDay(parsed)
}

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

    // Default to the next 14 days, anchored from the requested start when provided.
    let start: Date
    let end: Date

    try {
      start = parseDateParam(startDate, startOfDay(new Date()), 'start')
      end = parseDateParam(
        endDate,
        endOfDay(addDays(start, 14)),
        'end'
      )
    } catch (dateError) {
      ctx.logSuccess(400, {
        reason: 'invalid_date_range',
        error: dateError instanceof Error ? dateError.message : String(dateError),
      })
      return badRequest('Invalid startDate or endDate', responseHeaders)
    }

    if (start > end) {
      ctx.logSuccess(400, { reason: 'start_after_end' })
      return badRequest('startDate must be on or before endDate', responseHeaders)
    }

    const rangeDays = Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
    if (rangeDays > MAX_AVAILABILITY_RANGE_DAYS) {
      ctx.logSuccess(400, { reason: 'range_too_large', rangeDays })
      return badRequest(
        `Date range cannot exceed ${MAX_AVAILABILITY_RANGE_DAYS} days`,
        responseHeaders
      )
    }

    // Fetch busy times from Google Calendar
    const busyTimes = await fetchBusyTimes(calendarConfig, start, end)

    // Generate available slots for each date
    const slotsByDate: Record<string, AvailableSlot[]> = {}
    const availableDates: string[] = []

    let currentDate = new Date(start)
    while (currentDate <= end) {
      const dateStr = format(currentDate, 'yyyy-MM-dd')
      const slots = generateAvailableSlots(currentDate, calendarConfig, busyTimes)
      
      // Only include dates that have at least one available slot
      const hasAvailability = slots.some(slot => slot.available)
      if (hasAvailability) {
        slotsByDate[dateStr] = slots
        availableDates.push(dateStr)
      }

      currentDate = addDays(currentDate, 1)
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

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // Check if it's a calendar authorization error
    if (errorMessage.includes('revoked') || errorMessage.includes('expired')) {
      return NextResponse.json(
        { 
          error: errorMessage,
          fallback: true,
          message: 'Calendar authorization expired. Please call to schedule your tour.' 
        },
        { status: 503, headers: responseHeaders }
      )
    }

    return serverError(error, responseHeaders)
  }
}
