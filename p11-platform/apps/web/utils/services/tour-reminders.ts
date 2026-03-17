/**
 * TourSpark Tour Reminder Processor
 * Sends automated reminders 24 hours and 1 hour before scheduled tours
 */

import { createServiceClient } from '@/utils/supabase/admin'
import { sendMessage, type TemplateVariables } from './messaging'
import { format, parseISO, addHours, isBefore } from 'date-fns'

export interface TourWithLead {
  id: string
  lead_id: string
  property_id: string
  tour_date: string
  tour_time: string
  tour_type?: 'in_person' | 'virtual' | 'self_guided'
  status: string
  confirmation_sent_at?: string | null
  reminder_24h_sent_at: string | null
  reminder_sent_at?: string | null
  reminder_1h_sent_at?: string | null // For tour_bookings compatibility
  leads: {
    id: string
    first_name: string
    last_name: string
    email: string | null
    phone: string | null
  }
  properties: {
    id: string
    name: string
    address: {
      street?: string
      city?: string
      state?: string
      zip?: string
    } | null
  }
}

export interface TourBookingWithLead {
  id: string
  lead_id: string
  property_id: string
  scheduled_date: string
  scheduled_time: string
  status: string
  reminder_24h_sent_at: string | null
  reminder_1h_sent_at: string | null
  leads: {
    id: string
    first_name: string
    last_name: string
    email: string | null
    phone: string | null
  }
  properties: {
    id: string
    name: string
    address: {
      street?: string
      city?: string
      state?: string
      zip?: string
    } | null
  }
}

export interface ReminderResult {
  processed: number
  reminders24h: number
  reminders1h: number
  failed: number
  errors: string[]
}

const TOUR_TYPE_LABELS: Record<string, string> = {
  in_person: 'In-Person Tour',
  virtual: 'Virtual Tour',
  self_guided: 'Self-Guided Tour',
}

/**
 * Process all pending tour reminders
 * Should be called by a CRON job every 15-30 minutes
 * Handles both tours table (TourSpark) and tour_bookings table (LumaLeasing)
 */
export async function processTourReminders(): Promise<ReminderResult> {
  const supabase = createServiceClient()
  const now = new Date()
  const result: ReminderResult = {
    processed: 0,
    reminders24h: 0,
    reminders1h: 0,
    failed: 0,
    errors: [],
  }

  try {
    // Process TourSpark tours (tours table)
    await processTourSparkReminders(supabase, now, result)
    
    // Process LumaLeasing tour bookings (tour_bookings table)
    await processLumaLeasingReminders(supabase, now, result)

    console.log(
      `[TourReminders] Processed: ${result.processed}, 24h sent: ${result.reminders24h}, 1h sent: ${result.reminders1h}, Failed: ${result.failed}`
    )

    return result
  } catch (err) {
    console.error('[TourReminders] Fatal error:', err)
    result.errors.push(err instanceof Error ? err.message : 'Unknown fatal error')
    return result
  }
}

/**
 * Process TourSpark tours (tours table)
 */
async function processTourSparkReminders(
  supabase: ReturnType<typeof createServiceClient>,
  now: Date,
  result: ReminderResult
): Promise<void> {
  // Fetch all scheduled tours that need reminders
  // We look for tours happening in the next 25 hours (to catch 24h reminders)
  const tomorrow = addHours(now, 25)
  const todayStr = format(now, 'yyyy-MM-dd')
  const tomorrowStr = format(tomorrow, 'yyyy-MM-dd')

  const { data: tours, error } = await supabase
    .from('tours')
    .select(`
      id,
      lead_id,
      property_id,
      tour_date,
      tour_time,
      tour_type,
      status,
      confirmation_sent_at,
      reminder_24h_sent_at,
      reminder_sent_at,
      leads!inner (
        id,
        first_name,
        last_name,
        email,
        phone
      ),
      properties:property_id (
        id,
        name,
        address
      )
    `)
    .eq('status', 'scheduled')
    .or(`tour_date.eq.${todayStr},tour_date.eq.${tomorrowStr}`)
    .order('tour_date', { ascending: true })
    .order('tour_time', { ascending: true })

  if (error) {
    console.error('[TourReminders] Error fetching TourSpark tours:', error)
    result.errors.push(`TourSpark: ${error.message}`)
    return
  }

  if (!tours || tours.length === 0) {
    console.log('[TourReminders] No TourSpark tours found')
    return
  }

  console.log(`[TourReminders] Found ${tours.length} TourSpark tours to check`)

  // Process each tour
  for (const tour of tours as unknown as TourWithLead[]) {
    result.processed++

    // Parse tour datetime
    const tourDateTime = parseISO(`${tour.tour_date}T${tour.tour_time}`)
    const hoursUntilTour = (tourDateTime.getTime() - now.getTime()) / (1000 * 60 * 60)

    // Skip past tours
    if (isBefore(tourDateTime, now)) {
      continue
    }

    // Check if lead has contact info
    const lead = tour.leads
    if (!lead.phone && !lead.email) {
      console.log(`[TourReminders] Skipping TourSpark tour ${tour.id} - no contact info`)
      continue
    }

    try {
      // 24h reminder: Send if tour is 22-25 hours away and not sent yet
      if (hoursUntilTour >= 22 && hoursUntilTour <= 25 && !tour.reminder_24h_sent_at) {
        await send24hReminder(supabase, tour, 'tours')
        result.reminders24h++
      }
      // 1h reminder: Send if tour is 0.5-1.5 hours away and not sent yet
      else if (hoursUntilTour >= 0.5 && hoursUntilTour <= 1.5 && !tour.reminder_sent_at) {
        await send1hReminder(supabase, tour, 'tours')
        result.reminders1h++
      }
    } catch (err) {
      result.failed++
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      result.errors.push(`TourSpark tour ${tour.id}: ${errorMsg}`)
    }
  }
}

/**
 * Process LumaLeasing tour bookings (tour_bookings table)
 */
async function processLumaLeasingReminders(
  supabase: ReturnType<typeof createServiceClient>,
  now: Date,
  result: ReminderResult
): Promise<void> {
  // Fetch all confirmed bookings that need reminders
  const tomorrow = addHours(now, 25)
  const todayStr = format(now, 'yyyy-MM-dd')
  const tomorrowStr = format(tomorrow, 'yyyy-MM-dd')

  const { data: bookings, error } = await supabase
    .from('tour_bookings')
    .select(`
      id,
      lead_id,
      property_id,
      scheduled_date,
      scheduled_time,
      status,
      reminder_24h_sent_at,
      reminder_1h_sent_at,
      special_requests,
      leads!inner (
        id,
        first_name,
        last_name,
        email,
        phone
      ),
      properties:property_id (
        id,
        name,
        address
      )
    `)
    .eq('status', 'confirmed')
    .or(`scheduled_date.eq.${todayStr},scheduled_date.eq.${tomorrowStr}`)
    .order('scheduled_date', { ascending: true })
    .order('scheduled_time', { ascending: true })

  if (error) {
    console.error('[TourReminders] Error fetching LumaLeasing bookings:', error)
    result.errors.push(`LumaLeasing: ${error.message}`)
    return
  }

  if (!bookings || bookings.length === 0) {
    console.log('[TourReminders] No LumaLeasing tour bookings found')
    return
  }

  console.log(`[TourReminders] Found ${bookings.length} LumaLeasing bookings to check`)

  // Process each booking
  for (const booking of bookings as unknown as TourBookingWithLead[]) {
    result.processed++

    // Parse tour datetime
    const tourDateTime = parseISO(`${booking.scheduled_date}T${booking.scheduled_time}`)
    const hoursUntilTour = (tourDateTime.getTime() - now.getTime()) / (1000 * 60 * 60)

    // Skip past tours
    if (isBefore(tourDateTime, now)) {
      continue
    }

    // Check if lead has contact info
    const lead = booking.leads
    if (!lead.phone && !lead.email) {
      console.log(`[TourReminders] Skipping LumaLeasing booking ${booking.id} - no contact info`)
      continue
    }

    try {
      // 24h reminder: Send if tour is 22-25 hours away and not sent yet
      if (hoursUntilTour >= 22 && hoursUntilTour <= 25 && !booking.reminder_24h_sent_at) {
        await send24hReminderForBooking(supabase, booking)
        result.reminders24h++
      }
      // 1h reminder: Send if tour is 0.5-1.5 hours away and not sent yet
      else if (hoursUntilTour >= 0.5 && hoursUntilTour <= 1.5 && !booking.reminder_1h_sent_at) {
        await send1hReminderForBooking(supabase, booking)
        result.reminders1h++
      }
    } catch (err) {
      result.failed++
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      result.errors.push(`LumaLeasing booking ${booking.id}: ${errorMsg}`)
    }
  }
}

/**
 * Send 24-hour reminder for TourSpark tours
 */
async function send24hReminder(
  supabase: ReturnType<typeof createServiceClient>,
  tour: TourWithLead,
  table: 'tours' | 'tour_bookings'
): Promise<void> {
  const lead = tour.leads
  const property = tour.properties
  const variables = buildTemplateVariables(tour)

  console.log(`[TourReminders] Sending 24h reminder for ${table} ${tour.id} to ${lead.first_name}`)

  // Try SMS first
  if (lead.phone) {
    const smsBody = build24hSmsMessage(variables)
    const smsResult = await sendMessage({
      to: lead.phone,
      channel: 'sms',
      body: smsBody,
      propertyName: property?.name,
    })

    if (!smsResult.success) {
      console.error(`[TourReminders] SMS failed for ${table} ${tour.id}:`, smsResult.error)
    }
  }

  // Also send email if available
  if (lead.email) {
    const emailBody = build24hEmailMessage(variables)
    const emailResult = await sendMessage({
      to: lead.email,
      channel: 'email',
      subject: `Reminder: Your tour at ${property?.name || 'the property'} is tomorrow! 📅`,
      body: emailBody,
      propertyName: property?.name,
    })

    if (!emailResult.success) {
      console.error(`[TourReminders] Email failed for ${table} ${tour.id}:`, emailResult.error)
    }
  }

  // Mark reminder as sent
  await supabase
    .from(table)
    .update({
      reminder_24h_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', tour.id)
}

/**
 * Send 24-hour reminder for LumaLeasing tour bookings
 */
async function send24hReminderForBooking(
  supabase: ReturnType<typeof createServiceClient>,
  booking: TourBookingWithLead
): Promise<void> {
  const lead = booking.leads
  const property = booking.properties
  
  // Build variables from booking format
  const tourDateTime = parseISO(`${booking.scheduled_date}T${booking.scheduled_time}`)
  const variables: TemplateVariables = {
    first_name: lead.first_name,
    last_name: lead.last_name,
    property_name: property?.name || 'the property',
    tour_date: format(tourDateTime, 'EEEE, MMMM d'),
    tour_time: format(tourDateTime, 'h:mm a'),
    tour_type: 'Tour', // LumaLeasing bookings don't specify type
    property_address: property?.address?.street || '',
    property_city: property?.address?.city || '',
  }

  console.log(`[TourReminders] Sending 24h reminder for LumaLeasing booking ${booking.id} to ${lead.first_name}`)

  // Send email (LumaLeasing primarily uses email)
  if (lead.email) {
    const emailBody = build24hEmailMessage(variables)
    const emailResult = await sendMessage({
      to: lead.email,
      channel: 'email',
      subject: `Reminder: Your tour at ${property?.name || 'the property'} is tomorrow! 📅`,
      body: emailBody,
      propertyName: property?.name,
    })

    if (!emailResult.success) {
      console.error(`[TourReminders] Email failed for booking ${booking.id}:`, emailResult.error)
      throw new Error(emailResult.error)
    }
  }

  // Also try SMS if phone available
  if (lead.phone) {
    const smsBody = build24hSmsMessage(variables)
    await sendMessage({
      to: lead.phone,
      channel: 'sms',
      body: smsBody,
      propertyName: property?.name,
    })
  }

  // Mark reminder as sent
  await supabase
    .from('tour_bookings')
    .update({
      reminder_24h_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', booking.id)
}

/**
 * Send 1-hour reminder for TourSpark tours
 */
async function send1hReminder(
  supabase: ReturnType<typeof createServiceClient>,
  tour: TourWithLead,
  table: 'tours' | 'tour_bookings'
): Promise<void> {
  const lead = tour.leads
  const property = tour.properties
  const variables = buildTemplateVariables(tour)

  console.log(`[TourReminders] Sending 1h reminder for ${table} ${tour.id} to ${lead.first_name}`)

  // SMS is most effective for last-minute reminders
  if (lead.phone) {
    const smsBody = build1hSmsMessage(variables)
    const smsResult = await sendMessage({
      to: lead.phone,
      channel: 'sms',
      body: smsBody,
      propertyName: property?.name,
    })

    if (!smsResult.success) {
      console.error(`[TourReminders] SMS failed for ${table} ${tour.id}:`, smsResult.error)
    }
  }

  // Also send email for LumaLeasing bookings
  if (table === 'tour_bookings' && lead.email) {
    const emailBody = build1hEmailMessage(variables)
    await sendMessage({
      to: lead.email,
      channel: 'email',
      subject: `Tour in 1 Hour at ${property?.name || 'the property'} 🕐`,
      body: emailBody,
      propertyName: property?.name,
    })
  }

  // Mark reminder as sent
  await supabase
    .from(table)
    .update({
      reminder_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', tour.id)
}

/**
 * Send 1-hour reminder for LumaLeasing tour bookings
 */
async function send1hReminderForBooking(
  supabase: ReturnType<typeof createServiceClient>,
  booking: TourBookingWithLead
): Promise<void> {
  const lead = booking.leads
  const property = booking.properties
  
  // Build variables from booking format
  const tourDateTime = parseISO(`${booking.scheduled_date}T${booking.scheduled_time}`)
  const variables: TemplateVariables = {
    first_name: lead.first_name,
    last_name: lead.last_name,
    property_name: property?.name || 'the property',
    tour_date: format(tourDateTime, 'EEEE, MMMM d'),
    tour_time: format(tourDateTime, 'h:mm a'),
    tour_type: 'Tour',
    property_address: property?.address?.street || '',
    property_city: property?.address?.city || '',
  }

  console.log(`[TourReminders] Sending 1h reminder for LumaLeasing booking ${booking.id} to ${lead.first_name}`)

  // Send email (primary for LumaLeasing)
  if (lead.email) {
    const emailBody = build1hEmailMessage(variables)
    const emailResult = await sendMessage({
      to: lead.email,
      channel: 'email',
      subject: `Tour in 1 Hour at ${property?.name || 'the property'} 🕐`,
      body: emailBody,
      propertyName: property?.name,
    })

    if (!emailResult.success) {
      console.error(`[TourReminders] Email failed for booking ${booking.id}:`, emailResult.error)
      throw new Error(emailResult.error)
    }
  }

  // Also try SMS if available
  if (lead.phone) {
    const smsBody = build1hSmsMessage(variables)
    await sendMessage({
      to: lead.phone,
      channel: 'sms',
      body: smsBody,
      propertyName: property?.name,
    })
  }

  // Mark reminder as sent
  await supabase
    .from('tour_bookings')
    .update({
      reminder_1h_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', booking.id)
}

/**
 * Build template variables for messages from TourSpark tours
 */
function buildTemplateVariables(tour: TourWithLead): TemplateVariables {
  const lead = tour.leads
  const property = tour.properties
  const tourDateTime = parseISO(`${tour.tour_date}T${tour.tour_time}`)

  return {
    first_name: lead.first_name,
    last_name: lead.last_name,
    property_name: property?.name || 'the property',
    tour_date: format(tourDateTime, 'EEEE, MMMM d'),
    tour_time: format(tourDateTime, 'h:mm a'),
    tour_type: TOUR_TYPE_LABELS[tour.tour_type || 'in_person'] || 'Tour',
    property_address: property?.address?.street || '',
    property_city: property?.address?.city || '',
  }
}

/**
 * Build 24-hour SMS reminder message
 */
function build24hSmsMessage(variables: TemplateVariables): string {
  return `Hi ${variables.first_name}! 🏠 Just a reminder - your ${variables.tour_type?.toLowerCase()} at ${variables.property_name} is tomorrow at ${variables.tour_time}. We look forward to seeing you! Reply HELP for assistance or STOP to opt out.`
}

/**
 * Build 24-hour email reminder message
 */
function build24hEmailMessage(variables: TemplateVariables): string {
  return `Hi ${variables.first_name},

This is a friendly reminder that your ${variables.tour_type?.toLowerCase()} at ${variables.property_name} is scheduled for tomorrow!

📅 Date: ${variables.tour_date}
🕐 Time: ${variables.tour_time}
📍 Address: ${variables.property_address}${variables.property_city ? `, ${variables.property_city}` : ''}

What to Expect:
• Plan to arrive 5-10 minutes early
• Bring a valid ID
• Feel free to bring anyone who will be living with you

Need to reschedule? Just reply to this email or give us a call.

We look forward to meeting you!

Best regards,
${variables.property_name} Leasing Team`
}

/**
 * Build 1-hour SMS reminder message
 */
function build1hSmsMessage(variables: TemplateVariables): string {
  return `Hi ${variables.first_name}! Your tour at ${variables.property_name} starts in about an hour at ${variables.tour_time}. See you soon! 🔑`
}

/**
 * Build 1-hour email reminder message
 */
function build1hEmailMessage(variables: TemplateVariables): string {
  return `Hi ${variables.first_name},

Your tour at ${variables.property_name} starts in about 1 hour!

🕐 Time: ${variables.tour_time}
📍 Address: ${variables.property_address}${variables.property_city ? `, ${variables.property_city}` : ''}

We're ready for you! See you soon.

Best regards,
${variables.property_name} Team`
}

/**
 * Get pending reminders count (for dashboard display)
 */
export async function getPendingRemindersCount(propertyId?: string): Promise<{
  reminders24h: number
  reminders1h: number
}> {
  const supabase = createServiceClient()
  const now = new Date()
  const tomorrow = addHours(now, 25)
  const todayStr = format(now, 'yyyy-MM-dd')
  const tomorrowStr = format(tomorrow, 'yyyy-MM-dd')

  let toursQuery = supabase
    .from('tours')
    .select('id, tour_date, tour_time, reminder_24h_sent_at, reminder_sent_at')
    .eq('status', 'scheduled')
    .or(`tour_date.eq.${todayStr},tour_date.eq.${tomorrowStr}`)

  let bookingsQuery = supabase
    .from('tour_bookings')
    .select('id, scheduled_date, scheduled_time, reminder_24h_sent_at, reminder_1h_sent_at')
    .eq('status', 'confirmed')
    .or(`scheduled_date.eq.${todayStr},scheduled_date.eq.${tomorrowStr}`)

  if (propertyId) {
    toursQuery = toursQuery.eq('property_id', propertyId)
    bookingsQuery = bookingsQuery.eq('property_id', propertyId)
  }

  const { data: tours } = await toursQuery
  const { data: bookings } = await bookingsQuery

  let reminders24h = 0
  let reminders1h = 0

  if (tours) {
    for (const tour of tours) {
      const tourDateTime = parseISO(`${tour.tour_date}T${tour.tour_time}`)
      const hoursUntilTour = (tourDateTime.getTime() - now.getTime()) / (1000 * 60 * 60)

      if (hoursUntilTour >= 22 && hoursUntilTour <= 25 && !tour.reminder_24h_sent_at) {
        reminders24h++
      } else if (hoursUntilTour >= 0.5 && hoursUntilTour <= 1.5 && !tour.reminder_sent_at) {
        reminders1h++
      }
    }
  }

  if (bookings) {
    for (const booking of bookings) {
      const bookingDateTime = parseISO(`${booking.scheduled_date}T${booking.scheduled_time}`)
      const hoursUntilTour = (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60)

      if (hoursUntilTour >= 22 && hoursUntilTour <= 25 && !booking.reminder_24h_sent_at) {
        reminders24h++
      } else if (hoursUntilTour >= 0.5 && hoursUntilTour <= 1.5 && !booking.reminder_1h_sent_at) {
        reminders1h++
      }
    }
  }

  return { reminders24h, reminders1h }
}

