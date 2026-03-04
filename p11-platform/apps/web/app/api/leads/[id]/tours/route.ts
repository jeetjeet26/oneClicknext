import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { format } from 'date-fns'
import { generateTourEmail, TourEmailContext } from '@/utils/services/tour-email-generator'
import { sendEmail, EmailAttachment } from '@/utils/services/messaging'
import { generateTourICS, getICSAttachment, generateCalendarLinks, CalendarLinks } from '@/utils/services/calendar-invite'

type TourStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
type TourType = 'in_person' | 'virtual' | 'self_guided'

// GET - Fetch tours for a specific lead
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: leadId } = await params
  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
      throw error
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
      notes: booking.special_requests || booking.internal_notes,
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

    // Generate calendar links for each tour (Calendly-style)
    const propertyData = lead?.property ? (Array.isArray(lead.property) ? lead.property[0] : lead.property) : null
    const property: { name?: string; address?: { street?: string; full?: string } } = propertyData || {}
    const toursWithCalendar = allTours.map(tour => {
      // Only generate links for upcoming tours
      if (['scheduled', 'confirmed'].includes(tour.status)) {
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

    return NextResponse.json({ tours: toursWithCalendar, lead })
  } catch (error) {
    console.error('Tours fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch tours' }, { status: 500 })
  }
}

// POST - Create a new tour
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: leadId } = await params
  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
      return NextResponse.json({ error: 'Tour date and time are required' }, { status: 400 })
    }

    // Get lead info for confirmation message
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*, property:property_id(*)')
      .eq('id', leadId)
      .single()

    if (leadError || !lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
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
      console.error('Tour creation error:', tourError)
      return NextResponse.json({ error: 'Failed to create tour' }, { status: 500 })
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
      .update({ status: 'completed' })
      .eq('lead_id', leadId)
      .eq('status', 'active')

    // Send confirmation message if requested
    if (sendConfirmation && (lead.phone || lead.email)) {
      await sendTourConfirmation(supabase, tour, lead)
    }

    // Generate calendar links (Calendly-style) for admin to preview/share
    const property = lead.property || {}
    const calendarLinks = generateCalendarLinks({
      propertyName: property.name || 'Property Tour',
      propertyAddress: property.address?.street || property.address?.full,
      tourDate: tour.tour_date,
      tourTime: tour.tour_time,
      tourType: tour.tour_type as 'in_person' | 'virtual' | 'self_guided',
      durationMinutes: 30
    })

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
    }, { status: 201 })
  } catch (error) {
    console.error('Tour creation error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Update a tour (status, reschedule, etc.)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: leadId } = await params
  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
      return NextResponse.json({ error: 'Tour ID is required' }, { status: 400 })
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    }

    // Validate status if provided
    if (status) {
      const validStatuses: TourStatus[] = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }
      updateData.status = status

      // Update lead status based on tour outcome
      if (status === 'completed') {
        // Tour completed, lead might be interested - move to contacted for follow-up
        await supabase
          .from('leads')
          .update({ status: 'contacted', updated_at: new Date().toISOString() })
          .eq('id', leadId)
      } else if (status === 'cancelled' || status === 'no_show') {
        // Return lead to previous state
        await supabase
          .from('leads')
          .update({ status: 'contacted', updated_at: new Date().toISOString() })
          .eq('id', leadId)
      }
    }

    if (tourDate) updateData.tour_date = tourDate
    if (tourTime) updateData.tour_time = tourTime
    if (tourType) updateData.tour_type = tourType
    if (notes !== undefined) updateData.notes = notes

    const { data: tour, error } = await supabase
      .from('tours')
      .update(updateData)
      .eq('id', tourId)
      .eq('lead_id', leadId)
      .select()
      .single()

    if (error) {
      console.error('Tour update error:', error)
      return NextResponse.json({ error: 'Failed to update tour' }, { status: 500 })
    }

    // Fetch lead and property info for calendar links and notification
    const { data: lead } = await supabase
      .from('leads')
      .select('*, property:property_id(*)')
      .eq('id', leadId)
      .single()

    // Send notification if rescheduled and requested
    if (sendNotification && (tourDate || tourTime) && lead) {
      await sendTourConfirmation(supabase, tour, lead, true) // true = reschedule notification
    }

    // Generate calendar links (Calendly-style) for admin to preview/share
    const property = lead?.property || {}
    const calendarLinks = generateCalendarLinks({
      propertyName: property.name || 'Property Tour',
      propertyAddress: property.address?.street || property.address?.full,
      tourDate: tour.tour_date,
      tourTime: tour.tour_time,
      tourType: tour.tour_type as 'in_person' | 'virtual' | 'self_guided',
      durationMinutes: 30
    })

    return NextResponse.json({ 
      tour,
      // Calendly-style calendar links for admin to preview/share
      calendar: {
        google: calendarLinks.google,
        outlook: calendarLinks.outlook,
        office365: calendarLinks.office365,
        yahoo: calendarLinks.yahoo,
        icsDownload: calendarLinks.icsDownload,
      }
    })
  } catch (error) {
    console.error('Tour update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Cancel a tour
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: leadId } = await params
  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  try {
    const { searchParams } = new URL(request.url)
    const tourId = searchParams.get('tourId')

    if (!tourId) {
      return NextResponse.json({ error: 'Tour ID is required' }, { status: 400 })
    }

    // Soft delete - set status to cancelled
    const { error } = await supabase
      .from('tours')
      .update({ 
        status: 'cancelled',
        updated_at: new Date().toISOString()
      })
      .eq('id', tourId)
      .eq('lead_id', leadId)

    if (error) {
      throw error
    }

    // Check if lead has any other scheduled tours
    const { data: otherTours } = await supabase
      .from('tours')
      .select('id')
      .eq('lead_id', leadId)
      .eq('status', 'scheduled')

    // If no other tours, update lead status
    if (!otherTours || otherTours.length === 0) {
      await supabase
        .from('leads')
        .update({ status: 'contacted', updated_at: new Date().toISOString() })
        .eq('id', leadId)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Tour deletion error:', error)
    return NextResponse.json({ error: 'Failed to cancel tour' }, { status: 500 })
  }
}

// Helper function to send tour confirmation with LLM-generated personalized email
async function sendTourConfirmation(
  supabase: ReturnType<typeof createServiceClient>,
  tour: any,
  lead: any,
  isReschedule = false
) {
  try {
    const property = lead.property || {}
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
    } catch (err) {
      console.log('[Tour Confirmation] No conversation history found, proceeding without it')
    }

    // Build context for LLM email generation
    const emailContext: TourEmailContext = {
      lead: {
        firstName: lead.first_name,
        lastName: lead.last_name,
        email: lead.email,
        source: lead.source || 'unknown',
        moveInDate: lead.move_in_date,
        bedrooms: lead.bedrooms,
        notes: lead.notes
      },
      tour: {
        date: tourDate,
        time: tourTime,
        type: tour.tour_type as 'in_person' | 'virtual' | 'self_guided'
      },
      property: {
        name: property.name || 'our community',
        address: property.address?.street || property.address?.full || '',
        websiteUrl: property.website_url,
        amenities: property.amenities || [],
        petPolicy: property.pet_policy,
        parkingInfo: property.parking_info,
        brandVoice: property.brand_voice,
        officeHours: property.office_hours
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
        prospectName: `${lead.first_name} ${lead.last_name || ''}`.trim(),
        prospectEmail: lead.email,
        propertyEmail: property.contact_email || process.env.RESEND_FROM_EMAIL,
        specialRequests: tour.notes
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

    // TODO: Also send SMS if phone available (when Telnyx is configured)
    if (lead.phone && !lead.email) {
      console.log(`[Tour Confirmation] SMS would be sent to ${lead.phone} (Telnyx not configured)`)
    }

    return true
  } catch (error) {
    console.error('Failed to send tour confirmation:', error)
    return false
  }
}


