import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { format, parseISO, isAfter } from 'date-fns'
import { generateTourEmail, TourEmailContext } from '@/utils/services/tour-email-generator'
import { sendEmail, sendMessage, EmailAttachment } from '@/utils/services/messaging'
import { generateTourICS, getICSAttachment, generateCalendarLinks } from '@/utils/services/calendar-invite'
import { cancelCalendarEvent, getCalendarConfig, updateCalendarEvent } from '@/utils/services/google-calendar'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  badRequest,
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'

type TourStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
type TourType = 'in_person' | 'virtual' | 'self_guided'
type TourConfirmationTour = {
  id: string
  lead_id: string
  tour_date: string
  tour_time: string
  tour_type: TourType
  notes?: string | null
}
type TourConfirmationLead = {
  id: string
  first_name: string | null
  last_name: string | null
  email?: string | null
  phone?: string | null
  source?: string | null
  move_in_date?: string | null
  bedrooms?: string | number | null
  notes?: string | null
  property?: unknown
}

type PropertyRecord = {
  id?: string
  name?: string
  address?: { street?: string; full?: string } | null
  website_url?: string | null
  amenities?: string[]
  pet_policy?: Record<string, unknown> | null
  parking_info?: Record<string, unknown> | null
  brand_voice?: string | null
  office_hours?: Record<string, unknown> | null
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}

function normalizeProperty(value: unknown): PropertyRecord {
  const property = Array.isArray(value) ? value[0] : value
  if (!property || typeof property !== 'object') return {}

  const record = property as Record<string, unknown>
  const address =
    record.address && typeof record.address === 'object' && !Array.isArray(record.address)
      ? (record.address as { street?: string; full?: string })
      : null

  return {
    id: typeof record.id === 'string' ? record.id : undefined,
    name: typeof record.name === 'string' ? record.name : undefined,
    address,
    website_url: typeof record.website_url === 'string' ? record.website_url : null,
    amenities: Array.isArray(record.amenities)
      ? record.amenities.filter((item): item is string => typeof item === 'string')
      : [],
    pet_policy: asObject(record.pet_policy),
    parking_info: asObject(record.parking_info),
    brand_voice: typeof record.brand_voice === 'string' ? record.brand_voice : null,
    office_hours: asObject(record.office_hours),
  }
}

function toConfirmationTour(
  tour: {
    id: string
    lead_id?: string | null
    tour_date: string
    tour_time: string
    tour_type?: string | null
    notes?: string | null
  },
  fallbackLeadId: string
): TourConfirmationTour {
  return {
    id: tour.id,
    lead_id: tour.lead_id || fallbackLeadId,
    tour_date: tour.tour_date,
    tour_time: tour.tour_time,
    tour_type: (tour.tour_type as TourType) || 'in_person',
    notes: tour.notes ?? null,
  }
}

function toHourMinute(time: string): string {
  return time.split(':').slice(0, 2).join(':')
}

// GET - Fetch tours for a specific lead
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = createRequestContext(request, '/api/leads/[id]/tours')
  ctx.logStart()
  const { id: leadId } = await params
  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    ctx.logSuccess(401, { reason: 'unauthorized' })
    return unauthorized(ctx.responseHeaders)
  }

  const supabase = createServiceClient()

  try {
    // Fetch all tours from legacy 'tours' table
    const { data: tours, error } = await supabase
      .from('tours')
      .select(`
        *,
        assigned_agent:assigned_agent_id (
          id,
          full_name
        )
      `)
      .eq('lead_id', leadId)
      .order('tour_date', { ascending: true })
      .order('tour_time', { ascending: true })

    if (error) {
      ctx.logError(500, error, { operation: 'fetch_legacy_tours', leadId })
      return serverError(error, ctx.responseHeaders)
    }

    // Also fetch tours from 'tour_bookings' table (LumaLeasing widget bookings)
    const { data: tourBookings, error: bookingsError } = await supabase
      .from('tour_bookings')
      .select('*')
      .eq('lead_id', leadId)
      .order('scheduled_date', { ascending: true })
      .order('scheduled_time', { ascending: true })

    if (bookingsError) {
      console.error('Error fetching tour bookings:', bookingsError)
    }

    // Transform tour_bookings to match tours format
    const transformedBookings = (tourBookings || []).map(booking => ({
      id: booking.id,
      lead_id: booking.lead_id,
      property_id: booking.property_id,
      tour_date: booking.scheduled_date,
      tour_time: booking.scheduled_time,
      tour_type: 'in_person' as TourType, // Default, could enhance later
      status: booking.status as TourStatus,
      notes: booking.special_requests,
      assigned_agent: null,
      created_at: booking.created_at,
      updated_at: booking.updated_at,
      source: 'lumaleasing', // Mark as coming from widget
      duration_minutes: booking.duration_minutes
    }))

    // Merge both sources
    const allTours = [...(tours || []), ...transformedBookings]
    
    // Sort by date and time
    allTours.sort((a, b) => {
      const dateCompare = new Date(a.tour_date).getTime() - new Date(b.tour_date).getTime()
      if (dateCompare !== 0) return dateCompare
      return a.tour_time.localeCompare(b.tour_time)
    })

    // Fetch the lead info with property
    const { data: lead } = await supabase
      .from('leads')
      .select('id, first_name, last_name, email, phone, property_id, property:property_id(id, name, address)')
      .eq('id', leadId)
      .single()

    if (!lead) {
      ctx.logSuccess(404, { reason: 'lead_not_found', leadId })
      return notFound('Lead', ctx.responseHeaders)
    }

    if (!lead.property_id) {
      ctx.logSuccess(404, { reason: 'property_not_found', leadId })
      return notFound('Property', ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, lead.property_id)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', leadId, propertyId: lead.property_id })
      return forbidden(ctx.responseHeaders)
    }

    // Generate calendar links for each tour (Calendly-style)
    const property = normalizeProperty(lead.property)
    const toursWithCalendar = allTours.map(tour => {
      // Only generate links for upcoming tours
      if (['scheduled', 'confirmed'].includes(tour.status || '')) {
        const calendarLinks = generateCalendarLinks({
          propertyName: property.name || 'Property Tour',
          propertyAddress: property.address?.street || property.address?.full,
          tourDate: tour.tour_date,
          tourTime: tour.tour_time,
          tourType: tour.tour_type as 'in_person' | 'virtual' | 'self_guided',
          durationMinutes: 30
        })
        return {
          ...tour,
          calendar: {
            google: calendarLinks.google,
            outlook: calendarLinks.outlook,
            office365: calendarLinks.office365,
            yahoo: calendarLinks.yahoo,
            icsDownload: calendarLinks.icsDownload,
          }
        }
      }
      return tour
    })

    ctx.logSuccess(200, { leadId, tourCount: toursWithCalendar.length })
    return NextResponse.json({ tours: toursWithCalendar, lead }, { headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error, { operation: 'fetch_lead_tours' })
    return serverError(error, ctx.responseHeaders)
  }
}

// POST - Create a new tour
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = createRequestContext(request, '/api/leads/[id]/tours')
  ctx.logStart()
  const { id: leadId } = await params
  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    ctx.logSuccess(401, { reason: 'unauthorized' })
    return unauthorized(ctx.responseHeaders)
  }

  const supabase = createServiceClient()

  try {
    const body = await request.json()
    const { 
      tourDate, 
      tourTime, 
      tourType = 'in_person',
      notes,
      sendConfirmation = true,
      assignedAgentId
    } = body

    // Validation
    if (!tourDate || !tourTime) {
      ctx.logSuccess(400, { reason: 'missing_tour_datetime', leadId })
      return badRequest('Tour date and time are required', ctx.responseHeaders)
    }

    // Get lead info for confirmation message
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*, property:property_id(*)')
      .eq('id', leadId)
      .single()

    if (leadError || !lead) {
      ctx.logSuccess(404, { reason: 'lead_not_found', leadId })
      return notFound('Lead', ctx.responseHeaders)
    }

    if (!lead.property_id) {
      ctx.logSuccess(404, { reason: 'property_not_found', leadId })
      return notFound('Property', ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, lead.property_id)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', leadId, propertyId: lead.property_id })
      return forbidden(ctx.responseHeaders)
    }

    const proposedTourAt = parseISO(`${tourDate}T${tourTime}`)
    if (!isAfter(proposedTourAt, new Date())) {
      ctx.logSuccess(400, { reason: 'tour_in_past', leadId })
      return badRequest('Tour must be scheduled in the future', ctx.responseHeaders)
    }

    // Create the tour
    const { data: tour, error: tourError } = await supabase
      .from('tours')
      .insert({
        lead_id: leadId,
        property_id: lead.property_id,
        tour_date: tourDate,
        tour_time: tourTime,
        tour_type: tourType as TourType,
        status: 'scheduled',
        notes: notes || null,
        assigned_agent_id: assignedAgentId || null,
        created_by: user.id,
      })
      .select()
      .single()

    if (tourError) {
      ctx.logError(500, tourError, { operation: 'create_tour', leadId })
      return serverError(tourError, ctx.responseHeaders)
    }

    // Update lead status to tour_booked
    await supabase
      .from('leads')
      .update({ 
        status: 'tour_booked',
        updated_at: new Date().toISOString()
      })
      .eq('id', leadId)

    // Stop any active workflows since tour is booked
    await supabase
      .from('lead_workflows')
      .update({
        status: 'completed',
        next_action_at: null,
        processing_started_at: null,
        processing_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('lead_id', leadId)
      .eq('status', 'active')

    // Send confirmation message if requested
    if (sendConfirmation && (lead.phone || lead.email)) {
      await sendTourConfirmation(supabase, toConfirmationTour(tour, leadId), lead)
    }

    // Generate calendar links (Calendly-style) for admin to preview/share
    const property = normalizeProperty(lead.property)
    const calendarLinks = generateCalendarLinks({
      propertyName: property.name || 'Property Tour',
      propertyAddress: property.address?.street || property.address?.full,
      tourDate: tour.tour_date,
      tourTime: tour.tour_time,
      tourType: tour.tour_type as 'in_person' | 'virtual' | 'self_guided',
      durationMinutes: 30
    })

    ctx.logSuccess(201, { leadId, tourId: tour.id })
    return NextResponse.json({ 
      tour, 
      lead,
      // Calendly-style calendar links for admin to preview/share
      calendar: {
        google: calendarLinks.google,
        outlook: calendarLinks.outlook,
        office365: calendarLinks.office365,
        yahoo: calendarLinks.yahoo,
        icsDownload: calendarLinks.icsDownload,
      }
    }, { status: 201, headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error, { operation: 'create_tour' })
    return serverError(error, ctx.responseHeaders)
  }
}

// PATCH - Update a tour (status, reschedule, etc.)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = createRequestContext(request, '/api/leads/[id]/tours')
  ctx.logStart()
  const { id: leadId } = await params
  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    return unauthorized(ctx.responseHeaders)
  }

  const supabase = createServiceClient()

  try {
    const body = await request.json()
    const { 
      tourId,
      status,
      tourDate,
      tourTime,
      tourType,
      notes,
      sendNotification = false
    } = body

    if (!tourId) {
      ctx.logSuccess(400, { reason: 'missing_tour_id', leadId })
      return badRequest('Tour ID is required', ctx.responseHeaders)
    }

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('property_id')
      .eq('id', leadId)
      .single()

    if (leadError || !lead) {
      ctx.logSuccess(404, { reason: 'lead_not_found', leadId })
      return notFound('Lead', ctx.responseHeaders)
    }

    if (!lead.property_id) {
      ctx.logSuccess(404, { reason: 'property_not_found', leadId })
      return notFound('Property', ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, lead.property_id)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', leadId, propertyId: lead.property_id })
      return forbidden(ctx.responseHeaders)
    }

    const nowIso = new Date().toISOString()
    const validStatuses: TourStatus[] = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']
    if (status && !validStatuses.includes(status)) {
      ctx.logSuccess(400, { reason: 'invalid_status', status })
      return badRequest('Invalid status', ctx.responseHeaders)
    }

    const updateData: Record<string, unknown> = { updated_at: nowIso }
    if (status) updateData.status = status
    if (tourDate) updateData.tour_date = tourDate
    if (tourTime) updateData.tour_time = tourTime
    if (tourType) updateData.tour_type = tourType
    if (notes !== undefined) updateData.notes = notes

    // Try legacy tours table first.
    let tourLike:
      | {
          id: string
          tour_date: string
          tour_time: string
          tour_type: string
          notes?: string | null
        }
      | null = null
    const { data: updatedTour, error: tourUpdateError } = await supabase
      .from('tours')
      .update(updateData)
      .eq('id', tourId)
      .eq('lead_id', leadId)
      .select()
      .maybeSingle()

    if (tourUpdateError) {
      ctx.logError(500, tourUpdateError, { operation: 'update_tour', tourId, leadId })
      return serverError(tourUpdateError, ctx.responseHeaders)
    }

    if (updatedTour) {
      tourLike = {
        id: updatedTour.id,
        tour_date: updatedTour.tour_date,
        tour_time: updatedTour.tour_time,
        tour_type: updatedTour.tour_type || 'in_person',
        notes: updatedTour.notes,
      }
    } else {
      // Fallback to LumaLeasing tour_bookings lifecycle updates.
      const bookingUpdateData: Record<string, unknown> = { updated_at: nowIso }
      if (status) bookingUpdateData.status = status
      if (tourDate) bookingUpdateData.scheduled_date = tourDate
      if (tourTime) bookingUpdateData.scheduled_time = tourTime
      if (notes !== undefined) bookingUpdateData.special_requests = notes

      const { data: updatedBooking, error: bookingUpdateError } = await supabase
        .from('tour_bookings')
        .update(bookingUpdateData)
        .eq('id', tourId)
        .eq('lead_id', leadId)
        .select('id, property_id, lead_id, scheduled_date, scheduled_time, special_requests, status')
        .maybeSingle()

      if (bookingUpdateError) {
        ctx.logError(500, bookingUpdateError, { operation: 'update_tour_booking', tourId, leadId })
        return serverError(bookingUpdateError, ctx.responseHeaders)
      }

      if (!updatedBooking) {
        ctx.logSuccess(404, { reason: 'tour_not_found', tourId, leadId })
        return notFound('Tour', ctx.responseHeaders)
      }

      tourLike = {
        id: updatedBooking.id,
        tour_date: updatedBooking.scheduled_date,
        tour_time: updatedBooking.scheduled_time,
        tour_type: 'in_person',
        notes: updatedBooking.special_requests,
      }

      const calendarMutationNeeded =
        Boolean(tourDate || tourTime) || status === 'cancelled' || status === 'no_show'
      if (calendarMutationNeeded && updatedBooking.property_id && updatedBooking.lead_id) {
        const { data: bookingCalendarEvent } = await supabase
          .from('calendar_events')
          .select('id, google_event_id')
          .eq('tour_booking_id', updatedBooking.id)
          .maybeSingle()

        if (bookingCalendarEvent?.google_event_id) {
          const calendarConfig = await getCalendarConfig(updatedBooking.property_id)
          if (calendarConfig && calendarConfig.token_status === 'healthy') {
            try {
              if (status === 'cancelled' || status === 'no_show') {
                await cancelCalendarEvent(calendarConfig, bookingCalendarEvent.google_event_id)
              } else {
                const { data: leadForCalendar } = await supabase
                  .from('leads')
                  .select('first_name, last_name, email, phone')
                  .eq('id', updatedBooking.lead_id)
                  .maybeSingle()
                const leadEmail =
                  typeof leadForCalendar?.email === 'string' && leadForCalendar.email.length > 0
                    ? leadForCalendar.email
                    : null
                if (leadEmail) {
                  const { data: propertyForCalendar } = await supabase
                    .from('properties')
                    .select('name, address')
                    .eq('id', updatedBooking.property_id)
                    .maybeSingle()
                  const propertyRecord = normalizeProperty(propertyForCalendar)
                  const prospectName =
                    `${leadForCalendar?.first_name || ''} ${leadForCalendar?.last_name || ''}`.trim() ||
                    'Guest'

                  await updateCalendarEvent(calendarConfig, bookingCalendarEvent.google_event_id, {
                    propertyName: propertyRecord.name || 'Property Tour',
                    prospectName,
                    prospectEmail: leadEmail,
                    prospectPhone: leadForCalendar?.phone || undefined,
                    tourDate: updatedBooking.scheduled_date,
                    tourTime: toHourMinute(updatedBooking.scheduled_time),
                    specialRequests: updatedBooking.special_requests || undefined,
                    propertyAddress: propertyRecord.address?.street || propertyRecord.address?.full,
                  })
                }
              }

              await supabase
                .from('calendar_events')
                .update({
                  sync_status: 'synced',
                  last_synced_at: new Date().toISOString(),
                })
                .eq('id', bookingCalendarEvent.id)
            } catch (calendarSyncError) {
              await supabase
                .from('calendar_events')
                .update({
                  sync_status: 'failed',
                  last_synced_at: new Date().toISOString(),
                })
                .eq('id', bookingCalendarEvent.id)
              await supabase.from('lead_activities').insert({
                lead_id: updatedBooking.lead_id,
                type: 'calendar_sync_failed',
                description: `Calendar sync failed while updating booking ${updatedBooking.id}`,
                metadata: {
                  booking_id: updatedBooking.id,
                  google_event_id: bookingCalendarEvent.google_event_id,
                  reason:
                    calendarSyncError instanceof Error
                      ? calendarSyncError.message
                      : 'unknown_error',
                },
              })
            }
          }
        }
      }
    }

    // Update lead status based on tour outcome.
    if (status === 'completed') {
      await supabase
        .from('leads')
        .update({ status: 'toured', updated_at: nowIso })
        .eq('id', leadId)
    } else if (status === 'cancelled' || status === 'no_show') {
      await supabase
        .from('leads')
        .update({ status: 'contacted', updated_at: nowIso })
        .eq('id', leadId)
    }

    if (!tourLike) {
      ctx.logSuccess(404, { reason: 'tour_not_found_post_update', tourId, leadId })
      return notFound('Tour', ctx.responseHeaders)
    }

    // Fetch lead and property info for calendar links and notification
    const { data: leadWithProperty } = await supabase
      .from('leads')
      .select('*, property:property_id(*)')
      .eq('id', leadId)
      .single()

    // Send notification if rescheduled and requested
    if (sendNotification && (tourDate || tourTime) && leadWithProperty && tourLike) {
      await sendTourConfirmation(supabase, toConfirmationTour(tourLike, leadId), leadWithProperty, true) // true = reschedule notification
    }

    // Generate calendar links (Calendly-style) for admin to preview/share
    const property = normalizeProperty(leadWithProperty?.property)
    const calendarLinks = generateCalendarLinks({
      propertyName: property.name || 'Property Tour',
      propertyAddress: property.address?.street || property.address?.full,
      tourDate: tourLike?.tour_date || tourDate || '',
      tourTime: tourLike?.tour_time || tourTime || '',
      tourType: (tourLike?.tour_type as 'in_person' | 'virtual' | 'self_guided') || 'in_person',
      durationMinutes: 30
    })

    ctx.logSuccess(200, { leadId, tourId })
    return NextResponse.json({ 
      tour: tourLike,
      // Calendly-style calendar links for admin to preview/share
      calendar: {
        google: calendarLinks.google,
        outlook: calendarLinks.outlook,
        office365: calendarLinks.office365,
        yahoo: calendarLinks.yahoo,
        icsDownload: calendarLinks.icsDownload,
      }
    }, { headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error, { operation: 'update_tour' })
    return serverError(error, ctx.responseHeaders)
  }
}

// DELETE - Cancel a tour
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = createRequestContext(request, '/api/leads/[id]/tours')
  ctx.logStart()
  const { id: leadId } = await params
  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    return unauthorized(ctx.responseHeaders)
  }

  const supabase = createServiceClient()

  try {
    const { searchParams } = new URL(request.url)
    const tourId = searchParams.get('tourId')

    if (!tourId) {
      ctx.logSuccess(400, { reason: 'missing_tour_id', leadId })
      return badRequest('Tour ID is required', ctx.responseHeaders)
    }

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('property_id')
      .eq('id', leadId)
      .single()

    if (leadError || !lead) {
      ctx.logSuccess(404, { reason: 'lead_not_found', leadId })
      return notFound('Lead', ctx.responseHeaders)
    }

    if (!lead.property_id) {
      ctx.logSuccess(404, { reason: 'property_not_found', leadId })
      return notFound('Property', ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, lead.property_id)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', leadId, propertyId: lead.property_id })
      return forbidden(ctx.responseHeaders)
    }

    const nowIso = new Date().toISOString()

    // Soft delete legacy tour first.
    const { data: cancelledTour, error: cancelTourError } = await supabase
      .from('tours')
      .update({ 
        status: 'cancelled',
        updated_at: nowIso
      })
      .eq('id', tourId)
      .eq('lead_id', leadId)
      .select('id')
      .maybeSingle()

    if (cancelTourError) {
      ctx.logError(500, cancelTourError, { operation: 'cancel_tour', tourId, leadId })
      return serverError(cancelTourError, ctx.responseHeaders)
    }

    if (!cancelledTour) {
      // Fallback cancellation for LumaLeasing tour_bookings.
      const { data: cancelledBooking, error: cancelBookingError } = await supabase
        .from('tour_bookings')
        .update({
          status: 'cancelled',
          updated_at: nowIso,
        })
        .eq('id', tourId)
        .eq('lead_id', leadId)
        .select('id, property_id, lead_id')
        .maybeSingle()

      if (cancelBookingError) {
        ctx.logError(500, cancelBookingError, { operation: 'cancel_tour_booking', tourId, leadId })
        return serverError(cancelBookingError, ctx.responseHeaders)
      }

      if (!cancelledBooking) {
        ctx.logSuccess(404, { reason: 'tour_not_found', tourId, leadId })
        return notFound('Tour', ctx.responseHeaders)
      }

      const { data: bookingCalendarEvent } = await supabase
        .from('calendar_events')
        .select('id, google_event_id')
        .eq('tour_booking_id', cancelledBooking.id)
        .maybeSingle()

      if (bookingCalendarEvent?.google_event_id && cancelledBooking.property_id && cancelledBooking.lead_id) {
        const calendarConfig = await getCalendarConfig(cancelledBooking.property_id)
        if (calendarConfig && calendarConfig.token_status === 'healthy') {
          try {
            await cancelCalendarEvent(calendarConfig, bookingCalendarEvent.google_event_id)
            await supabase
              .from('calendar_events')
              .update({
                sync_status: 'synced',
                last_synced_at: new Date().toISOString(),
              })
              .eq('id', bookingCalendarEvent.id)
          } catch (calendarSyncError) {
            await supabase
              .from('calendar_events')
              .update({
                sync_status: 'failed',
                last_synced_at: new Date().toISOString(),
              })
              .eq('id', bookingCalendarEvent.id)
            await supabase.from('lead_activities').insert({
              lead_id: cancelledBooking.lead_id,
              type: 'calendar_sync_failed',
              description: `Calendar sync failed while cancelling booking ${cancelledBooking.id}`,
              metadata: {
                booking_id: cancelledBooking.id,
                google_event_id: bookingCalendarEvent.google_event_id,
                reason:
                  calendarSyncError instanceof Error
                    ? calendarSyncError.message
                    : 'unknown_error',
              },
            })
          }
        }
      }
    }

    // Check if lead has any other scheduled tours
    const { data: otherTours } = await supabase
      .from('tours')
      .select('id')
      .eq('lead_id', leadId)
      .in('status', ['scheduled', 'confirmed'])

    const { data: otherBookings } = await supabase
      .from('tour_bookings')
      .select('id')
      .eq('lead_id', leadId)
      .in('status', ['scheduled', 'confirmed'])

    // If no other tours, update lead status
    if ((!otherTours || otherTours.length === 0) && (!otherBookings || otherBookings.length === 0)) {
      await supabase
        .from('leads')
        .update({ status: 'contacted', updated_at: nowIso })
        .eq('id', leadId)
    }

    ctx.logSuccess(200, { leadId, tourId })
    return NextResponse.json({ success: true }, { headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error, { operation: 'cancel_tour' })
    return serverError(error, ctx.responseHeaders)
  }
}

// Helper function to send tour confirmation with LLM-generated personalized email
async function sendTourConfirmation(
  supabase: ReturnType<typeof createServiceClient>,
  tour: TourConfirmationTour,
  lead: TourConfirmationLead,
  isReschedule = false
) {
  try {
    const property = normalizeProperty(lead.property)
    const tourDate = format(new Date(tour.tour_date), 'EEEE, MMMM d, yyyy')
    const tourTime = format(new Date(`2000-01-01T${tour.tour_time}`), 'h:mm a')

    // Fetch conversation history if this lead came from Luma or has chat history
    let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
    
    try {
      const { data: conversations } = await supabase
        .from('conversations')
        .select(`
          id,
          messages(role, content, created_at)
        `)
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
        .limit(1)

      if (conversations && conversations.length > 0 && conversations[0].messages) {
        // Sort messages by created_at and format for context
        const messages = conversations[0].messages as Array<{ role: string; content: string; created_at: string }>
        conversationHistory = messages
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
          .map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content
          }))
      }
    } catch {
      console.log('[Tour Confirmation] No conversation history found, proceeding without it')
    }

    // Build context for LLM email generation
    const emailContext: TourEmailContext = {
      lead: {
        firstName: lead.first_name || 'there',
        lastName: lead.last_name || undefined,
        email: lead.email || '',
        source: lead.source || 'unknown',
        moveInDate: lead.move_in_date,
        bedrooms: lead.bedrooms != null ? String(lead.bedrooms) : null,
        notes: lead.notes
      },
      tour: {
        date: tourDate,
        time: tourTime,
        type: tour.tour_type as 'in_person' | 'virtual' | 'self_guided'
      },
      property: {
        name: property.name || 'our community',
        address: property.address?.street || property.address?.full || undefined,
        websiteUrl: property.website_url || undefined,
        amenities: property.amenities || [],
        petPolicy: property.pet_policy || undefined,
        parkingInfo: property.parking_info || undefined,
        brandVoice: property.brand_voice || undefined,
        officeHours: property.office_hours || undefined
      },
      conversationHistory: conversationHistory.length > 0 ? conversationHistory : undefined,
      isReschedule
    }

    // Send email if available
    if (lead.email) {
      console.log(`[Tour Confirmation] Generating personalized email for ${lead.email}...`)
      
      // Generate personalized email using LLM
      const generatedEmail = await generateTourEmail(emailContext)
      
      console.log(`[Tour Confirmation] Generated email with subject: "${generatedEmail.subject}"`)
      
      // Generate .ics calendar invite
      const icsContent = generateTourICS({
        propertyName: property.name || 'Property Tour',
        propertyAddress: property.address?.street || property.address?.full,
        tourDate: tour.tour_date,
        tourTime: tour.tour_time,
        tourType: tour.tour_type as 'in_person' | 'virtual' | 'self_guided',
        durationMinutes: 30,
        prospectName: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
        prospectEmail: lead.email,
        propertyEmail: process.env.RESEND_FROM_EMAIL,
        specialRequests: tour.notes || undefined
      })
      
      const icsAttachment = getICSAttachment(icsContent)
      const attachments: EmailAttachment[] = [{
        filename: icsAttachment.filename,
        content: icsAttachment.content,
        contentType: icsAttachment.contentType
      }]
      
      console.log(`[Tour Confirmation] Generated .ics calendar invite`)
      
      // Send via Resend with calendar attachment
      const emailResult = await sendEmail(
        lead.email,
        generatedEmail.subject,
        generatedEmail.textBody,
        undefined, // use default from email
        generatedEmail.htmlBody,
        attachments
      )

      if (emailResult.success) {
        console.log(`[Tour Confirmation] ✅ Email sent to ${lead.email}, ID: ${emailResult.messageId}`)
        
        // Mark confirmation as sent
        await supabase
          .from('tours')
          .update({ confirmation_sent_at: new Date().toISOString() })
          .eq('id', tour.id)

        // Log activity
        await supabase
          .from('lead_activities')
          .insert({
            lead_id: lead.id,
            type: 'email_sent',
            description: isReschedule 
              ? 'Tour reschedule confirmation sent'
              : 'Tour confirmation email sent',
            metadata: {
              tour_id: tour.id,
              email_subject: generatedEmail.subject,
              email_message_id: emailResult.messageId,
              tour_date: tourDate,
              tour_time: tourTime,
              tour_type: tour.tour_type,
              had_conversation_context: conversationHistory.length > 0
            }
          })
      } else {
        console.error(`[Tour Confirmation] ❌ Failed to send email: ${emailResult.error}`)
      }
    }

    // Send SMS confirmation when phone exists (in addition to email when both exist)
    if (lead.phone) {
      const smsResult = await sendMessage({
        to: lead.phone,
        channel: 'sms',
        body: `${isReschedule ? 'Update:' : 'Confirmed:'} tour at ${property.name || 'our community'} on ${tourDate} at ${tourTime}. Reply STOP to opt out.`,
        propertyName: property.name,
      })
      if (!smsResult.success) {
        console.error(`[Tour Confirmation] SMS failed: ${smsResult.error}`)
      }
    }

    return true
  } catch (error) {
    console.error('Failed to send tour confirmation:', error)
    return false
  }
}


