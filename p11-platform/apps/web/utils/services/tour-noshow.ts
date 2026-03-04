/**
 * TourSpark Tour No-Show Processor
 * Handles automated follow-ups for leads who missed their scheduled tours
 */

import { createServiceClient } from '@/utils/supabase/admin'
import { sendMessage, type TemplateVariables } from './messaging'
import { startWorkflow } from './workflow-processor'
import { trackEngagementEvent } from './engagement-tracker'
import { format, parseISO, subHours, isBefore } from 'date-fns'

export interface TourForNoShow {
  id: string
  lead_id: string
  property_id: string
  tour_date: string
  tour_time: string
  tour_type: 'in_person' | 'virtual' | 'self_guided'
  status: string
  noshow_followup_sent_at: string | null
  leads: {
    id: string
    first_name: string
    last_name: string
    email: string | null
    phone: string | null
    status: string
  }
  properties: {
    id: string
    name: string
    address: {
      street?: string
      city?: string
    } | null
  }
}

export interface NoShowResult {
  processed: number
  markedNoShow: number
  followupsSent: number
  failed: number
  errors: string[]
}

const TOUR_TYPE_LABELS: Record<string, string> = {
  in_person: 'in-person tour',
  virtual: 'virtual tour',
  self_guided: 'self-guided tour',
}

/**
 * Process tour no-shows
 * - Marks scheduled tours that are past their time as no_show (if not completed/confirmed)
 * - Sends follow-up messages to encourage rescheduling
 * Should be called by CRON job hourly
 */
export async function processTourNoShows(): Promise<NoShowResult> {
  const supabase = createServiceClient()
  const now = new Date()
  const result: NoShowResult = {
    processed: 0,
    markedNoShow: 0,
    followupsSent: 0,
    failed: 0,
    errors: [],
  }

  try {
    // Look for scheduled tours that ended more than 1 hour ago
    // (giving some buffer for late arrivals)
    const cutoffTime = subHours(now, 1)
    const todayStr = format(now, 'yyyy-MM-dd')
    const yesterdayStr = format(subHours(now, 24), 'yyyy-MM-dd')

    // Find tours that should be marked as no-show
    const { data: potentialNoShows, error: fetchError } = await supabase
      .from('tours')
      .select(`
        id,
        lead_id,
        property_id,
        tour_date,
        tour_time,
        tour_type,
        status,
        noshow_followup_sent_at,
        leads!inner (
          id,
          first_name,
          last_name,
          email,
          phone,
          status
        ),
        properties:property_id (
          id,
          name,
          address
        )
      `)
      .eq('status', 'scheduled')
      .or(`tour_date.eq.${todayStr},tour_date.eq.${yesterdayStr}`)

    if (fetchError) {
      console.error('[TourNoShow] Error fetching tours:', fetchError)
      result.errors.push(fetchError.message)
      return result
    }

    if (!potentialNoShows || potentialNoShows.length === 0) {
      console.log('[TourNoShow] No scheduled tours to check')
      return result
    }

    console.log(`[TourNoShow] Checking ${potentialNoShows.length} scheduled tours`)

    for (const tour of potentialNoShows as unknown as TourForNoShow[]) {
      result.processed++

      try {
        // Parse tour datetime
        const tourDateTime = parseISO(`${tour.tour_date}T${tour.tour_time}`)
        
        // Only process if tour time has passed by at least 1 hour
        if (!isBefore(tourDateTime, cutoffTime)) {
          continue // Tour hasn't happened yet or just ended
        }

        // Mark as no-show
        const { error: updateError } = await supabase
          .from('tours')
          .update({
            status: 'no_show',
            updated_at: now.toISOString(),
          })
          .eq('id', tour.id)

        if (updateError) {
          throw new Error(`Failed to update tour status: ${updateError.message}`)
        }

        result.markedNoShow++
        console.log(`[TourNoShow] Marked tour ${tour.id} as no-show`)

        // Track no-show engagement event and trigger workflow (non-blocking)
        trackEngagementEvent({
          leadId: tour.lead_id,
          propertyId: tour.property_id,
          eventType: 'tour_no_show',
          metadata: { tour_id: tour.id },
        }).catch(e => console.error('[TourNoShow] Engagement tracking failed:', e))

        startWorkflow(tour.lead_id, tour.property_id, 'tour_no_show').catch(e =>
          console.error('[TourNoShow] Workflow start failed:', e)
        )

        // Update lead status back to contacted
        await supabase
          .from('leads')
          .update({
            status: 'contacted',
            updated_at: now.toISOString(),
          })
          .eq('id', tour.lead_id)

        // Send follow-up if not already sent
        if (!tour.noshow_followup_sent_at) {
          const followupSent = await sendNoShowFollowup(supabase, tour)
          if (followupSent) {
            result.followupsSent++
          }
        }
      } catch (err) {
        result.failed++
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        result.errors.push(`Tour ${tour.id}: ${errorMsg}`)
      }
    }

    console.log(
      `[TourNoShow] Processed: ${result.processed}, Marked no-show: ${result.markedNoShow}, Follow-ups sent: ${result.followupsSent}, Failed: ${result.failed}`
    )

    return result
  } catch (err) {
    console.error('[TourNoShow] Fatal error:', err)
    result.errors.push(err instanceof Error ? err.message : 'Unknown fatal error')
    return result
  }
}

/**
 * Send no-show follow-up message
 */
async function sendNoShowFollowup(
  supabase: ReturnType<typeof createServiceClient>,
  tour: TourForNoShow
): Promise<boolean> {
  const lead = tour.leads
  const property = tour.properties

  // Skip if lead already leased or lost
  if (['leased', 'lost'].includes(lead.status)) {
    console.log(`[TourNoShow] Skipping follow-up for lead ${lead.id} - status: ${lead.status}`)
    return false
  }

  // Build variables for message
  const tourDateTime = parseISO(`${tour.tour_date}T${tour.tour_time}`)
  const variables: TemplateVariables = {
    first_name: lead.first_name,
    last_name: lead.last_name,
    property_name: property?.name || 'the property',
    tour_date: format(tourDateTime, 'EEEE, MMMM d'),
    tour_time: format(tourDateTime, 'h:mm a'),
    tour_type: TOUR_TYPE_LABELS[tour.tour_type] || 'tour',
  }

  let messageSent = false

  // Try SMS first
  if (lead.phone) {
    const smsBody = buildNoShowSmsMessage(variables)
    const smsResult = await sendMessage({
      to: lead.phone,
      channel: 'sms',
      body: smsBody,
      propertyName: property?.name,
    })

    if (smsResult.success) {
      messageSent = true
      console.log(`[TourNoShow] Sent SMS follow-up for tour ${tour.id}`)
    } else {
      console.error(`[TourNoShow] SMS failed:`, smsResult.error)
    }
  }

  // Also send email
  if (lead.email) {
    const emailBody = buildNoShowEmailMessage(variables)
    const emailResult = await sendMessage({
      to: lead.email,
      channel: 'email',
      subject: `We missed you at ${variables.property_name}! Let's reschedule`,
      body: emailBody,
      propertyName: property?.name,
    })

    if (emailResult.success) {
      messageSent = true
      console.log(`[TourNoShow] Sent email follow-up for tour ${tour.id}`)
    } else {
      console.error(`[TourNoShow] Email failed:`, emailResult.error)
    }
  }

  // Mark follow-up as sent
  if (messageSent) {
    await supabase
      .from('tours')
      .update({
        noshow_followup_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', tour.id)
  }

  return messageSent
}

/**
 * Build no-show SMS message
 */
function buildNoShowSmsMessage(variables: TemplateVariables): string {
  return `Hi ${variables.first_name}, we missed you at your ${variables.tour_type} today! No worries - life happens. We'd love to reschedule when you're ready. Reply or call us to pick a new time. 🏠`
}

/**
 * Build no-show email message
 */
function buildNoShowEmailMessage(variables: TemplateVariables): string {
  return `Hi ${variables.first_name},

We noticed you weren't able to make it to your scheduled ${variables.tour_type} at ${variables.property_name} today. No worries at all – we know life can get busy!

We'd love the opportunity to show you around when the timing works better for you.

Here are a few ways to reschedule:
• Reply directly to this email with your preferred date and time
• Call our leasing office during business hours
• Visit our website to book online

We're holding some great units that we think would be perfect for you, and we'd hate for you to miss out!

Looking forward to meeting you soon.

Warm regards,
${variables.property_name} Leasing Team

P.S. If your plans have changed and you're no longer looking, just let us know and we'll update our records.`
}

/**
 * Get no-show statistics for a property
 */
export async function getNoShowStats(propertyId: string): Promise<{
  totalNoShows: number
  followupsSent: number
  rescheduled: number
}> {
  const supabase = createServiceClient()

  // Get total no-shows
  const { count: totalNoShows } = await supabase
    .from('tours')
    .select('*', { count: 'exact', head: true })
    .eq('property_id', propertyId)
    .eq('status', 'no_show')

  // Get follow-ups sent
  const { count: followupsSent } = await supabase
    .from('tours')
    .select('*', { count: 'exact', head: true })
    .eq('property_id', propertyId)
    .eq('status', 'no_show')
    .not('noshow_followup_sent_at', 'is', null)

  // Get rescheduled (leads who had a no-show but later booked another tour)
  const { data: noShowLeads } = await supabase
    .from('tours')
    .select('lead_id')
    .eq('property_id', propertyId)
    .eq('status', 'no_show')

  let rescheduled = 0
  if (noShowLeads && noShowLeads.length > 0) {
    const leadIds = noShowLeads.map(t => t.lead_id)
    const { count } = await supabase
      .from('tours')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', propertyId)
      .in('lead_id', leadIds)
      .in('status', ['scheduled', 'confirmed', 'completed'])

    rescheduled = count || 0
  }

  return {
    totalNoShows: totalNoShows || 0,
    followupsSent: followupsSent || 0,
    rescheduled,
  }
}

