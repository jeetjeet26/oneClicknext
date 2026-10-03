import {scheduleChangeSchema,changeTourSchedule,scheduleFailure,getTourScheduleHistory} from '@/utils/services/tour-scheduling'
import {bookConsoleTour,consoleBookingSchema,bookingFailure,getBookingContext,getTourCalendarSchedules} from '@/utils/services/console-tour-booking'
import {isDeliveryPaused} from '@/utils/services/delivery-guard'
import { validateBody, tourCompleteSchema } from '@/utils/services/validation'
import { findTourForOutcome, recordTourOutcome, outcomeFailure, getTourOutcomeHistory } from '@/utils/services/tour-outcomes'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import {getNoShowReview} from '@/utils/services/tour-noshow'
import { NextRequest, NextResponse } from 'next/server'
import { generateCalendarLinks } from '@/utils/services/calendar-invite'
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
      return serverError(bookingsError, ctx.responseHeaders)
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
      duration_minutes: booking.duration_minutes,
      schedule_timezone: (booking as typeof booking & {schedule_timezone?:string|null}).schedule_timezone ?? null,
      schedule_version: (booking as unknown as {schedule_version:number}).schedule_version
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
    const [outcomes,schedules,noShowReview,bookingContext,calendarSchedules] = await Promise.all([getTourOutcomeHistory(supabase, lead.property_id, leadId),getTourScheduleHistory(supabase,lead.property_id,leadId),getNoShowReview(supabase,lead.property_id,leadId),getBookingContext(supabase,lead.property_id),getTourCalendarSchedules(supabase,lead.property_id,leadId)])
    const outcomeNotes = new Map(outcomes.map(item => [`${item.tour_source}/${item.tour_id}`, item]))
    const toursWithCalendar = allTours.map(record => {
      const source = 'source' in record && record.source === 'lumaleasing' ? 'tour_bookings' : 'tours'
      const savedOutcome = outcomeNotes.get(`${source}/${record.id}`)
      const timing=calendarSchedules.get(`${source}/${record.id}`)
      const tour = {...record, timezone:timing?.timezone || (record as typeof record & {schedule_timezone?:string|null}).schedule_timezone || null, starts_at:timing?.startsAt || null, no_show_review: noShowReview.get(`${source}/${record.id}`) ?? null, outcome_notes: savedOutcome?.notes ?? null, correction: savedOutcome?.correction ?? null, schedule_change: schedules.get(`${source}/${record.id}`) ?? null}
      // Only generate links for upcoming tours
      if (['scheduled', 'confirmed'].includes(tour.status || '')) {
        if(!timing?.startsAt||timing.issue)return {...tour,calendar:null,calendar_issue:timing?.issue||'needs_timezone'}
        const calendarLinks = generateCalendarLinks({
          propertyName: property.name || 'Property Tour',
          propertyAddress: property.address?.street || property.address?.full,
          tourDate: tour.tour_date,
          tourTime: tour.tour_time,
          tourType: tour.tour_type as 'in_person' | 'virtual' | 'self_guided',
          durationMinutes:timing.durationMinutes,startsAt:timing.startsAt,uid:`tour-${record.id}-v${(record as unknown as {schedule_version:number}).schedule_version}@p11`
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
    return NextResponse.json({ tours: toursWithCalendar, lead,bookingContext }, { headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error, { operation: 'fetch_lead_tours' })
    return serverError(error, ctx.responseHeaders)
  }
}

// POST - Reserve once, record the operator decision and queue confirmations atomically.
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
 const ctx=createRequestContext(request,'/api/leads/[id]/tours');ctx.logStart()
 try {
  const {id:leadId}=await params;const auth=await createClient();const {data:{user},error}=await auth.auth.getUser()
  if(error||!user)return unauthorized(ctx.responseHeaders)
  const input=consoleBookingSchema.safeParse(await request.json().catch(()=>null))
  if(!input.success)return badRequest('A valid date, time, tour type and request ID are required; notes may contain up to 2000 characters.',ctx.responseHeaders)
  const db=createServiceClient();const lead=await db.from('leads').select('property_id').eq('id',leadId).single()
  if(lead.error||!lead.data?.property_id)return notFound('Lead',ctx.responseHeaders)
  if(!(await validatePropertyAccess(user.id,lead.data.property_id)).authorized)return forbidden(ctx.responseHeaders)
  const result=await bookConsoleTour({...input.data,propertyId:lead.data.property_id,leadId,actorId:user.id},db)
  const failure=bookingFailure(result.state)
  if(failure)return NextResponse.json({...failure,code:result.state},{status:failure.status,headers:ctx.responseHeaders})
  ctx.logSuccess(result.state==='replayed'?200:201,{leadId,tourId:result.tour!.id})
  return NextResponse.json({...result,deliveryPaused:isDeliveryPaused()},{status:result.state==='replayed'?200:201,headers:{...ctx.responseHeaders,'Cache-Control':'no-store'}})
 }catch(error){ctx.logError(500,error,{operation:'create_tour'});return serverError(error,ctx.responseHeaders)}
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

    const validStatuses: TourStatus[] = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']
    if (status && !validStatuses.includes(status)) {
      ctx.logSuccess(400, { reason: 'invalid_status', status })
      return badRequest('Invalid status', ctx.responseHeaders)
    }

    if (status === 'completed' || status === 'no_show') {
      const validated = validateBody({tourId, notes,requestId:body.requestId}, tourCompleteSchema)
      if (!validated.success) return badRequest(validated.error, ctx.responseHeaders)
      if (tourDate || tourTime || tourType || sendNotification || (notes !== undefined && (typeof notes !== 'string' || notes.length > 2000))) {
        return badRequest('Record the tour outcome separately from schedule changes; notes must be at most 2000 characters.', ctx.responseHeaders)
      }
      const existing = await findTourForOutcome(supabase, tourId, leadId)
      if (!existing || existing.property_id !== lead.property_id) return notFound('Tour', ctx.responseHeaders)
      const result = await recordTourOutcome({propertyId: lead.property_id, leadId,
        source: existing.source, tourId, outcome: status, notes: validated.data.notes,actorId:user.id,requestId:validated.data.requestId}, supabase)
      const failure = outcomeFailure(result)
      if (failure) return NextResponse.json({error: failure.error}, {status: failure.status, headers: ctx.responseHeaders})
      return NextResponse.json({tour: {id: tourId, status, outcome_notes: result.outcome!.notes, completedAt: status === 'completed' ? result.outcome!.outcome_at : null},
        leadStatus: result.leadStatus, followup: result.outcome!.followup_state, replayed: result.state !== 'applied'}, {headers: ctx.responseHeaders})
    }

    const validated = scheduleChangeSchema.safeParse(body)
    if (!validated.success) return badRequest('A schedule action, current version, request ID and reason are required. Refresh the tour history and try again.', ctx.responseHeaders)
    const existing = await findTourForOutcome(supabase,tourId,leadId)
    if (!existing || existing.property_id !== lead.property_id) return notFound('Tour',ctx.responseHeaders)
    const result = await changeTourSchedule({...validated.data,propertyId:lead.property_id,leadId,source:existing.source,actorId:user.id},supabase)
    const failure = scheduleFailure(result)
    if(failure) return NextResponse.json({...failure,code:result.state},{status:failure.status,headers:ctx.responseHeaders})
    ctx.logSuccess(200,{leadId,tourId,changeId:result.changeId,replayed:result.state==='replayed'})
    return NextResponse.json(result,{headers:{...ctx.responseHeaders,'Cache-Control':'no-store'}})
  } catch (error) {
    ctx.logError(500, error, { operation: 'update_tour' })
    return serverError(error, ctx.responseHeaders)
  }
}

// Old DELETE callers must supply the same deliberate, versioned change contract.
export async function DELETE(request: NextRequest,context:{params:Promise<{id:string}>}) {
 const query=new URL(request.url).searchParams
 return PATCH(new NextRequest(request.url,{method:'PATCH',headers:request.headers,body:JSON.stringify({
  tourId:query.get('tourId'),requestId:query.get('requestId'),expectedVersion:Number(query.get('expectedVersion')),
  reason:query.get('reason'),action:'cancel',notify:query.get('notify')==='true',
 })}),context)
}
