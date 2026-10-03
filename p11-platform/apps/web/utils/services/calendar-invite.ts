/**
 * .ics Calendar Invite Generator
 * Generates universal calendar invites compatible with Google Calendar, Outlook, Apple Calendar, etc.
 */

export interface CalendarEventDetails {
  // Required
  title: string
  startDate: string // ISO date: '2025-12-15'
  startTime: string // 24h format: '14:00'
  durationMinutes: number
  startsAt?: string // Explicit instant; preferred when the property timezone is known.
  uid?: string
  timestamp?: string
  
  // Optional
  description?: string
  location?: string
  organizerName?: string
  organizerEmail?: string
  attendeeName?: string
  attendeeEmail?: string
  
  // Reminders (in minutes before event)
  reminders?: number[] // e.g., [1440, 60] for 24h and 1h reminders
}

/**
 * Generate a .ics file content for a calendar event
 * Follows the iCalendar specification (RFC 5545)
 */
export function generateICSContent(event: CalendarEventDetails): string {
  const uid = event.uid || generateUID()
  const now = formatDateTimeUTC(event.timestamp ? new Date(event.timestamp) : new Date())
  
  // Parse start date and time
  const [year, month, day] = event.startDate.split('-').map(Number)
  const [hours, minutes] = event.startTime.split(':').map(Number)
  
  // Create start datetime
  const startDateTime = event.startsAt ? new Date(event.startsAt) : new Date(year, month - 1, day, hours, minutes, 0)
  const endDateTime = new Date(startDateTime.getTime() + event.durationMinutes * 60 * 1000)
  
  // Format for iCal (YYYYMMDDTHHMMSS)
  if(Number.isNaN(startDateTime.getTime()))throw new Error("Invalid calendar instant")
  const dtStart = event.startsAt ? formatDateTimeUTC(startDateTime) : formatDateTimeLocal(startDateTime)
  const dtEnd = event.startsAt ? formatDateTimeUTC(endDateTime) : formatDateTimeLocal(endDateTime)
  
  // Build the .ics content
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//P11 Platform//LumaLeasing//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeICSText(event.title)}`,
  ]
  
  // Add optional fields
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeICSText(event.description)}`)
  }
  
  if (event.location) {
    lines.push(`LOCATION:${escapeICSText(event.location)}`)
  }
  
  if (event.organizerEmail) {
    const organizerName = event.organizerName || event.organizerEmail.split('@')[0]
    lines.push(`ORGANIZER;CN=${escapeICSText(organizerName)}:mailto:${event.organizerEmail}`)
  }
  
  if (event.attendeeEmail) {
    const attendeeName = event.attendeeName || event.attendeeEmail.split('@')[0]
    lines.push(`ATTENDEE;CN=${escapeICSText(attendeeName)};RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:${event.attendeeEmail}`)
  }
  
  // Add reminders
  const reminders = event.reminders || [1440, 60] // Default: 24h and 1h
  for (const minutesBefore of reminders) {
    lines.push('BEGIN:VALARM')
    lines.push('ACTION:DISPLAY')
    lines.push(`DESCRIPTION:Reminder: ${event.title}`)
    lines.push(`TRIGGER:-PT${minutesBefore}M`)
    lines.push('END:VALARM')
  }
  
  lines.push('END:VEVENT')
  lines.push('END:VCALENDAR')
  
  return lines.join('\r\n')
}

/**
 * Generate a .ics file for a tour booking
 */
export function generateTourICS(options: {
  startsAt?: string
  uid?: string
  propertyName: string
  propertyAddress?: string
  tourDate: string // '2025-12-15'
  tourTime: string // '14:00' or '2:00 PM'
  tourType: 'in_person' | 'virtual' | 'self_guided'
  durationMinutes?: number
  prospectName: string
  prospectEmail: string
  propertyEmail?: string
  specialRequests?: string
}): string {
  const {
    propertyName,
    propertyAddress,
    tourDate,
    tourTime,
    tourType,
    durationMinutes = 30,
    prospectName,
    prospectEmail,
    propertyEmail,
    specialRequests
  } = options
  
  // Convert 12h time to 24h if needed
  const time24h = convertTo24Hour(tourTime)
  
  // Build description
  const tourTypeLabel = {
    'in_person': 'In-Person Tour',
    'virtual': 'Virtual Tour',
    'self_guided': 'Self-Guided Tour'
  }[tourType]
  
  let description = `${tourTypeLabel} at ${propertyName}`
  if (tourType === 'in_person' && propertyAddress) {
    description += `\\n\\nAddress: ${propertyAddress}`
  }
  if (tourType === 'virtual') {
    description += '\\n\\nYou will receive a video call link before your scheduled time.'
  }
  if (tourType === 'self_guided') {
    description += '\\n\\nCheck in at the leasing office to get your access code.'
  }
  if (specialRequests) {
    description += `\\n\\nSpecial requests: ${specialRequests}`
  }
  description += '\\n\\nQuestions? Reply to the confirmation email or call the leasing office.'
  
  return generateICSContent({
    startsAt: options.startsAt, uid: options.uid,
    title: `Tour: ${propertyName}`,
    startDate: tourDate,
    startTime: time24h,
    durationMinutes,
    description,
    location: propertyAddress,
    organizerEmail: propertyEmail,
    organizerName: propertyName,
    attendeeName: prospectName,
    attendeeEmail: prospectEmail,
    reminders: [1440, 60] // 24h and 1h before
  })
}

/**
 * Get the .ics file as a base64-encoded attachment for email
 */
export function getICSAttachment(icsContent: string): {
  filename: string
  content: string
  contentType: string
} {
  return {
    filename: 'tour-invite.ics',
    content: Buffer.from(icsContent).toString('base64'),
    contentType: 'text/calendar; method=REQUEST'
  }
}

// Helper: Generate unique ID for calendar event
function generateUID(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 15)
  return `${timestamp}-${random}@lumaleasing.p11.app`
}

// Helper: Format date for iCal (UTC)
function formatDateTimeUTC(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

// Helper: Format date for iCal (local time with timezone)
function formatDateTimeLocal(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}${month}${day}T${hours}${minutes}${seconds}`
}

// Helper: Escape special characters for iCal text
function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

// Helper: Convert 12h time format to 24h
function convertTo24Hour(time: string): string {
  // Already in 24h format (e.g., "14:00")
  if (/^\d{1,2}:\d{2}$/.test(time) && !time.toLowerCase().includes('am') && !time.toLowerCase().includes('pm')) {
    return time.padStart(5, '0')
  }
  
  // Parse 12h format (e.g., "2:00 PM", "10:30 AM")
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i)
  if (match) {
    let hours = parseInt(match[1])
    const minutes = match[2]
    const period = match[3].toLowerCase()
    
    if (period === 'pm' && hours !== 12) {
      hours += 12
    } else if (period === 'am' && hours === 12) {
      hours = 0
    }
    
    return `${String(hours).padStart(2, '0')}:${minutes}`
  }
  
  // Return as-is if we can't parse
  return time
}

/**
 * Generate a download URL for the .ics file (data URI)
 * Can be used in the response to let users download the file
 */
export function getICSDataURI(icsContent: string): string {
  const base64 = Buffer.from(icsContent).toString('base64')
  return `data:text/calendar;base64,${base64}`
}

/**
 * Calendly-style calendar links
 * Generate direct "Add to Calendar" URLs for different providers
 */

export interface CalendarLinks {
  google: string
  outlook: string
  office365: string
  yahoo: string
  icsDownload: string // data URI for .ics file
}

export interface TourCalendarOptions {
  startsAt?: string
  uid?: string
  propertyName: string
  propertyAddress?: string
  tourDate: string // '2025-12-15'
  tourTime: string // '14:00' or '2:00 PM'
  tourType: 'in_person' | 'virtual' | 'self_guided'
  durationMinutes?: number
}

/**
 * Generate all calendar links (Calendly-style)
 * Returns URLs for Google, Outlook, Office365, Yahoo, and a .ics download
 */
export function generateCalendarLinks(options: TourCalendarOptions): CalendarLinks {
  const {
    propertyName,
    propertyAddress,
    tourDate,
    tourTime,
    tourType,
    durationMinutes = 30
  } = options

  const time24h = convertTo24Hour(tourTime)
  const [hours, minutes] = time24h.split(':').map(Number)
  const [year, month, day] = tourDate.split('-').map(Number)

  // Create start and end datetimes
  const startDateTime = options.startsAt ? new Date(options.startsAt) : new Date(year, month - 1, day, hours, minutes, 0)
  const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60 * 1000)

  const title = `Tour: ${propertyName}`
  
  const tourTypeLabel = {
    'in_person': 'In-Person Tour',
    'virtual': 'Virtual Tour',
    'self_guided': 'Self-Guided Tour'
  }[tourType]

  let description = `${tourTypeLabel} at ${propertyName}.`
  if (tourType === 'in_person' && propertyAddress) {
    description += ` Address: ${propertyAddress}.`
  }
  if (tourType === 'virtual') {
    description += ' You will receive a video call link before your scheduled time.'
  }
  if (tourType === 'self_guided') {
    description += ' Check in at the leasing office to get your access code.'
  }

  const location = tourType === 'in_person' ? propertyAddress || propertyName : propertyName

  // Generate .ics content for download
  const icsContent = generateICSContent({
    title,
    startsAt:options.startsAt,uid:options.uid,
    startDate: tourDate,
    startTime: time24h,
    durationMinutes,
    description,
    location,
    reminders: [1440, 60]
  })

  return {
    google: generateGoogleCalendarLink(title, startDateTime, endDateTime, description, location),
    outlook: generateOutlookLink(title, startDateTime, endDateTime, description, location),
    office365: generateOffice365Link(title, startDateTime, endDateTime, description, location),
    yahoo: generateYahooCalendarLink(title, startDateTime, endDateTime, description, location),
    icsDownload: getICSDataURI(icsContent)
  }
}

/**
 * Google Calendar "Add Event" URL
 * Opens Google Calendar with pre-filled event details
 */
function generateGoogleCalendarLink(
  title: string,
  startDateTime: Date,
  endDateTime: Date,
  description: string,
  location?: string
): string {
  const formatForGoogle = (date: Date) => {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  }

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${formatForGoogle(startDateTime)}/${formatForGoogle(endDateTime)}`,
    details: description,
    ...(location && { location })
  })

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/**
 * Outlook.com Calendar "Add Event" URL
 */
function generateOutlookLink(
  title: string,
  startDateTime: Date,
  endDateTime: Date,
  description: string,
  location?: string
): string {
  const formatForOutlook = (date: Date) => {
    return date.toISOString()
  }

  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: title,
    startdt: formatForOutlook(startDateTime),
    enddt: formatForOutlook(endDateTime),
    body: description,
    ...(location && { location })
  })

  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`
}

/**
 * Office 365 Calendar "Add Event" URL
 */
function generateOffice365Link(
  title: string,
  startDateTime: Date,
  endDateTime: Date,
  description: string,
  location?: string
): string {
  const formatForOutlook = (date: Date) => {
    return date.toISOString()
  }

  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: title,
    startdt: formatForOutlook(startDateTime),
    enddt: formatForOutlook(endDateTime),
    body: description,
    ...(location && { location })
  })

  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`
}

/**
 * Yahoo Calendar "Add Event" URL
 */
function generateYahooCalendarLink(
  title: string,
  startDateTime: Date,
  endDateTime: Date,
  description: string,
  location?: string
): string {
  const formatForYahoo = (date: Date) => {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(0, 15)
  }

  // Yahoo uses duration in HHMM format
  const durationMs = endDateTime.getTime() - startDateTime.getTime()
  const durationHours = Math.floor(durationMs / (1000 * 60 * 60))
  const durationMinutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60))
  const duration = `${String(durationHours).padStart(2, '0')}${String(durationMinutes).padStart(2, '0')}`

  const params = new URLSearchParams({
    v: '60',
    title: title,
    st: formatForYahoo(startDateTime),
    dur: duration,
    desc: description,
    ...(location && { in_loc: location })
  })

  return `https://calendar.yahoo.com/?${params.toString()}`
}

/**
 * Generate all calendar options for a tour booking response
 * This is the main function to call from the API route
 */
export function generateTourCalendarResponse(options: {
  startsAt?: string
  uid?: string
  propertyName: string
  propertyAddress?: string
  tourDate: string
  tourTime: string
  tourType: 'in_person' | 'virtual' | 'self_guided'
  durationMinutes?: number
  prospectName: string
  prospectEmail: string
  propertyEmail?: string
  specialRequests?: string
}): {
  icsContent: string
  icsAttachment: { filename: string; content: string; contentType: string }
  calendarLinks: CalendarLinks
} {
  // Generate .ics for email attachment
  const icsContent = generateTourICS(options)
  const icsAttachment = getICSAttachment(icsContent)

  // Generate calendar links for response
  const calendarLinks = generateCalendarLinks({
    startsAt: options.startsAt, uid: options.uid,
    propertyName: options.propertyName,
    propertyAddress: options.propertyAddress,
    tourDate: options.tourDate,
    tourTime: options.tourTime,
    tourType: options.tourType,
    durationMinutes: options.durationMinutes
  })

  return {
    icsContent,
    icsAttachment,
    calendarLinks
  }
}

