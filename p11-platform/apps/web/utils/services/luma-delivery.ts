import {calendarDateTimeInstant} from './calendar-time'
import type { Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { generateTourCalendarResponse } from './calendar-invite'
import { isDeliveryPaused } from './delivery-guard'
import { createCalendarEvent,getCalendarConfig } from './google-calendar'
import { sendEmail } from './messaging'
import { phaseFourDb } from './phase-four-db'

type Job = {schedule_version:number;id:string;property_id:string;booking_id:string;lease_token:string;calendar_confirmed:boolean;email_confirmed:boolean;
  payload:{timezone?:string;startsAt?:string;calendarId:string;providerCalendarId:string;provider?:'google'|'microsoft';bookingDate:string;bookingTime:string;durationMinutes:number;propertyName:string;propertyAddress:string;specialRequests?:string;leadInfo:{first_name?:string;last_name?:string;email:string;phone?:string}}}
export async function processLumaDelivery(limit=5) {
  const result = {processed:0,succeeded:0,failed:0,paused:isDeliveryPaused()}
  if (result.paused) return result
  const db = createServiceClient()
  const durable = phaseFourDb(db)
  for(let i=0;i<Math.min(limit,5);i++) {
    const claimed = await durable.rpc('claim_luma_delivery')
    if(claimed.error) throw claimed.error
    if(!claimed.data) break
    const job = claimed.data as unknown as Job
    result.processed++
    const checkpoint = async(stage:string,receipt:Json) => {
      const saved = await durable.rpc('save_luma_delivery',{p_id:job.id,p_token:job.lease_token,p_stage:stage,p_receipt:receipt})
      if(saved.error || !saved.data) throw new Error('Delivery checkpoint was not confirmed')
    }
    try {
      const {data:booking,error} = await db.from('tour_bookings').select('*').eq('id',job.booking_id).eq('property_id',job.property_id).single()
      if(error || !booking) throw new Error('Booking could not be loaded')
      if(job.schedule_version!==(booking as unknown as {schedule_version:number}).schedule_version || !['confirmed','scheduled'].includes(booking.status || '')) {
        await checkpoint('review',{error:'booking_changed'});result.failed++;continue
      }
      const p = job.payload
      if(p.bookingDate!==booking.scheduled_date || p.bookingTime!==booking.scheduled_time.slice(0,5) || p.durationMinutes!==booking.duration_minutes) {
        await checkpoint('review',{error:'booking_changed'});result.failed++;continue
      }
      const calendar = await getCalendarConfig(job.property_id)
      if (!calendar || calendar.token_status !== 'healthy') throw new Error('Calendar connection needs attention')
      if (!p.timezone || !p.startsAt || calendar.timezone !== p.timezone || calendarDateTimeInstant(`${p.bookingDate}T${p.bookingTime}:00`, p.timezone) !== calendarDateTimeInstant(p.startsAt)) {
        await checkpoint('review', {error: 'booking_timezone_needs_review'}); result.failed++; continue
      }
      if (calendar.id !== p.calendarId || calendar.calendar_id !== p.providerCalendarId || calendar.provider !== p.provider) {
        await checkpoint('review', {error: 'calendar_destination_changed'}); result.failed++; continue
      }
      const name = [p.leadInfo.first_name,p.leadInfo.last_name].filter(Boolean).join(' ') || 'Guest'
      if(!job.calendar_confirmed) {
        // Microsoft transactionId lifetime is not guaranteed by its public
        // contract. Ambiguous failures are held instead of automatically replayed.
        try {
          const event = await createCalendarEvent({...calendar, tour_duration_minutes: booking.duration_minutes || p.durationMinutes},{requestId:job.booking_id,propertyName:p.propertyName,
            prospectName:name,prospectEmail:p.leadInfo.email,prospectPhone:p.leadInfo.phone,
            tourDate:booking.scheduled_date,tourTime:booking.scheduled_time.slice(0,5),propertyAddress:p.propertyAddress,specialRequests:p.specialRequests})
          await checkpoint('calendar',{...event,calendarId:calendar.id})
        } catch(error) {
          if(calendar.provider==='microsoft') { await checkpoint('review',{error:'calendar_receipt_unconfirmed'});result.failed++;continue }
          throw error
        }
      }
      if(!job.email_confirmed) {
        const invite = generateTourCalendarResponse({startsAt:p.startsAt,uid:`tour-${job.booking_id}@p11`,propertyName:p.propertyName,propertyAddress:p.propertyAddress,
          tourDate:booking.scheduled_date,tourTime:booking.scheduled_time,tourType:'in_person',durationMinutes:booking.duration_minutes || 30,
          prospectName:name,prospectEmail:p.leadInfo.email,propertyEmail:process.env.RESEND_FROM_EMAIL})
        const email = await sendEmail(p.leadInfo.email,`Your tour at ${p.propertyName}`,
          `Hi ${name}, your tour at ${p.propertyName} is reserved for ${booking.scheduled_date} at ${booking.scheduled_time.slice(0,5)} (${p.timezone}). Your calendar invitation is attached.`,
          undefined,undefined,[invite.icsAttachment],`luma-tour/${job.booking_id}`)
        if(!email.success || !email.messageId) throw new Error('Confirmation email was not accepted')
        await checkpoint('email',{messageId:email.messageId})
      }
      result.succeeded++
    } catch {
      await checkpoint('retry',{error:'provider_or_storage_unavailable'})
      result.failed++
    }
  }
  return result
}
