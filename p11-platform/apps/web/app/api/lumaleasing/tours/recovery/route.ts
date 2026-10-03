import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  badRequest,
  forbidden,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'
import {validCalendarDay} from '@/utils/services/calendar-time'
import {changeTourSchedule,scheduleFailure} from '@/utils/services/tour-scheduling'

const CursorSchema=z.object({date:z.string().refine(validCalendarDay),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/),id:z.string().regex(/^[0-9a-f-]{36}$/i)}).strict()

const RecoveryActionSchema = z.object({
  requestId:z.string().uuid(),
  expectedVersion:z.number().int().positive(),
  propertyId: z.string().min(1),
  bookingId: z.string().min(1),
  action: z.enum(['cancel', 'reschedule']),
  rescheduleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  rescheduleTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  reason: z.string().trim().min(1).max(2000),
})

type RecoveryBookingRow = {
  schedule_timezone:string|null
  schedule_version:number
  id: string
  property_id: string | null
  lead_id: string | null
  scheduled_date: string
  scheduled_time: string
  duration_minutes: number | null
  status: string | null
  special_requests: string | null
}

type CalendarEventRow = {
  remote_snapshot: {id:string;status:string|null;startDateTime:string|null;endDateTime:string|null}|null
  observed_schedule_version:number|null
  last_synced_at:string|null
  id: string
  google_event_id: string
  sync_status: string | null
}

type LeadRow = {
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
}

function normalizeLeadName(lead: LeadRow | null): string {
  if (!lead) {
    return 'Guest'
  }
  const composed = `${lead.first_name || ''} ${lead.last_name || ''}`.trim()
  return composed || 'Guest'
}

function isRecoverableStatus(status: string | null): boolean {
  return status === 'scheduled' || status === 'confirmed'
}

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/lumaleasing/tours/recovery')
  ctx.logStart()

  try {
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')
    const encodedCursor=searchParams.get('cursor')
    let cursor:z.infer<typeof CursorSchema>|null=null
    if(encodedCursor){
      try{if(encodedCursor.length>512)throw new Error('Invalid cursor');cursor=CursorSchema.parse(JSON.parse(Buffer.from(encodedCursor,'base64url').toString('utf8')))}
      catch{return badRequest('Invalid booking page. Refresh the list.',ctx.responseHeaders)}
    }

    if (!propertyId) {
      ctx.logSuccess(400, { reason: 'missing_property_id' })
      return badRequest('Property ID required', ctx.responseHeaders)
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', propertyId, userId: user.id })
      return forbidden(ctx.responseHeaders)
    }

    const serviceSupabase = createServiceClient()
    let bookingQuery=serviceSupabase
      .from('tour_bookings')
      .select('id, property_id, lead_id, scheduled_date, scheduled_time, duration_minutes, status, special_requests, schedule_version, schedule_timezone')
      .eq('property_id',propertyId)
      .in('status',['scheduled','confirmed'])
      .order('scheduled_date',{ascending:true}).order('scheduled_time',{ascending:true}).order('id',{ascending:true})
      .limit(101)
    if(cursor)bookingQuery=bookingQuery.or(`scheduled_date.gt.${cursor.date},and(scheduled_date.eq.${cursor.date},scheduled_time.gt.${cursor.time}),and(scheduled_date.eq.${cursor.date},scheduled_time.eq.${cursor.time},id.gt.${cursor.id})`)
    const {data:bookingRows,error:bookingError}=await bookingQuery

    if (bookingError) {
      ctx.logError(500, bookingError, { operation: 'load_recovery_bookings', propertyId })
      return serverError(bookingError, ctx.responseHeaders)
    }
    const scopedBookings=(bookingRows||[]).slice(0,100) as unknown as RecoveryBookingRow[]
    const {data:calendarEventRows,error:calendarError}=scopedBookings.length?await serviceSupabase
      .from('calendar_events').select('id, tour_booking_id, google_event_id, sync_status, remote_snapshot, observed_schedule_version, last_synced_at')
      .in('tour_booking_id',scopedBookings.map(booking=>booking.id)):{data:[],error:null}
    if (calendarError) {
      ctx.logError(500, calendarError, { operation: 'load_recovery_calendar_events', propertyId })
      return serverError(calendarError, ctx.responseHeaders)
    }

    const bookings = scopedBookings
    const leadIds = Array.from(new Set(bookings.map((booking) => booking.lead_id).filter(Boolean))) as string[]

    const { data: leadRows, error: leadError } = leadIds.length
      ? await serviceSupabase
          .from('leads')
          .select('id, first_name, last_name, email, phone')
          .eq('property_id',propertyId)
          .in('id', leadIds)
      : { data: [], error: null }

    if (leadError) {
      ctx.logError(500, leadError, { operation: 'load_recovery_leads', propertyId })
      return serverError(leadError, ctx.responseHeaders)
    }

    const leadById = new Map(
      ((leadRows || []) as Array<LeadRow & { id: string }>).map((lead) => [lead.id, lead])
    )
    const eventByBookingId = new Map(
      ((calendarEventRows || []) as unknown as Array<CalendarEventRow & { tour_booking_id: string | null }>)
        .filter((row): row is CalendarEventRow & { tour_booking_id: string } => Boolean(row.tour_booking_id))
        .map((row) => [row.tour_booking_id, row])
    )

    const recoverableBookings = bookings.map((booking) => {
      const lead = booking.lead_id ? leadById.get(booking.lead_id) || null : null
      const calendarEvent = eventByBookingId.get(booking.id) || null
      return {
        id: booking.id,
        lead: lead
          ? {
              name: normalizeLeadName(lead),
              email: lead.email,
              phone: lead.phone,
            }
          : null,
        schedule_timezone:booking.schedule_timezone,
        scheduled_date: booking.scheduled_date,
        scheduled_time: booking.scheduled_time,
        duration_minutes: booking.duration_minutes,
        schedule_version:booking.schedule_version,
        status: booking.status,
        special_requests: booking.special_requests,
        can_cancel: isRecoverableStatus(booking.status),
        can_reschedule: isRecoverableStatus(booking.status),
        calendar_event: calendarEvent
          ? {
              id: calendarEvent.id,
              google_event_id: calendarEvent.google_event_id,
              sync_status: calendarEvent.sync_status,
              remote_snapshot:calendarEvent.remote_snapshot,
              observed_schedule_version:calendarEvent.observed_schedule_version,
              last_synced_at:calendarEvent.last_synced_at,
            }
          : null,
      }
    })

    ctx.logSuccess(200, {
      propertyId,
      bookingCount: recoverableBookings.length,
    })

    return NextResponse.json(
      {
        bookings: recoverableBookings,
        nextCursor:(bookingRows||[]).length>100?Buffer.from(JSON.stringify({date:bookings[99].scheduled_date,time:bookings[99].scheduled_time,id:bookings[99].id})).toString('base64url'):null,
      },
      { headers: {...ctx.responseHeaders,'Cache-Control':'no-store'} }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'load_recovery_bookings' })
    return serverError(error, ctx.responseHeaders)
  }
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/lumaleasing/tours/recovery')
  ctx.logStart()

  try {
    const body = await request.json()
    const parsed = RecoveryActionSchema.safeParse(body)
    if (!parsed.success) {
      ctx.logSuccess(400, { reason: 'invalid_request_body' })
      return badRequest('Invalid recovery action payload', ctx.responseHeaders)
    }

    const { propertyId, bookingId, action, rescheduleDate, rescheduleTime, reason } = parsed.data

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', propertyId, userId: user.id })
      return forbidden(ctx.responseHeaders)
    }

    const serviceSupabase = createServiceClient()

    const {data:booking,error:bookingError}=await serviceSupabase.from('tour_bookings').select('id,property_id,lead_id,scheduled_date,scheduled_time,duration_minutes,status,special_requests,schedule_version').eq('id',bookingId).eq('property_id',propertyId).maybeSingle()
    if(bookingError || !booking)return badRequest('Booking not found for property',ctx.responseHeaders)
    const bookingRow = booking as RecoveryBookingRow
    if(!bookingRow.lead_id)return badRequest('Booking has no linked lead',ctx.responseHeaders)
    if(action==='reschedule' && (!rescheduleDate || !rescheduleTime))return badRequest('Choose a new date and time',ctx.responseHeaders)
    const result=await changeTourSchedule({propertyId,leadId:bookingRow.lead_id,source:'tour_bookings',tourId:bookingId,actorId:user.id,
      requestId:parsed.data.requestId,expectedVersion:parsed.data.expectedVersion,action,reason,notify:false,date:rescheduleDate,time:rescheduleTime},serviceSupabase)
    const failure=scheduleFailure(result)
    if(failure)return NextResponse.json({error:failure.error,code:result.state},{status:failure.status,headers:ctx.responseHeaders})
    ctx.logSuccess(200,{propertyId,bookingId,action,changeId:result.changeId})
    return NextResponse.json({...result,success:true,bookingId,action,calendarAction:result.queued?'queued':'not_required'},{headers:ctx.responseHeaders})
  } catch (error) {
    ctx.logError(500, error, { operation: 'booking_recovery_action' })
    return serverError(error, ctx.responseHeaders)
  }
}
