/**
 * Google Calendar API Utility
 * Handles token refresh, API calls, and availability generation
 */

import crypto from 'crypto'
import { createServiceClient } from '@/utils/supabase/admin'
import { getMicrosoftTokenUrl } from '@/utils/services/integration-provider-config'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const MICROSOFT_GRAPH_API = 'https://graph.microsoft.com/v1.0'
const DEFAULT_CALENDAR_WATCH_TTL_SECONDS = 60 * 60 * 24 * 7

interface CalendarConfigRow {
  id: string
  property_id: string | null
  provider: string | null
  google_email: string | null
  account_email: string | null
  calendar_id: string | null
  access_token: string | null
  refresh_token: string | null
  token_expires_at: string | null
  working_hours: Record<string, { start: string; end: string; enabled: boolean }> | null
  tour_duration_minutes: number | null
  buffer_minutes: number | null
  timezone: string | null
  token_status: string | null
  provider_metadata: Record<string, unknown> | null
  watch_channel_id: string | null
  watch_last_message_number: number | null
  watch_resource_id: string | null
  watch_expiration: string | null
}

export interface CalendarConfig {
  id: string
  property_id: string
  provider?: 'google' | 'microsoft'
  google_email: string
  account_email?: string
  calendar_id: string
  access_token: string
  refresh_token: string
  token_expires_at: string
  working_hours: Record<string, { start: string; end: string; enabled: boolean }>
  tour_duration_minutes: number
  buffer_minutes: number
  timezone: string
  token_status: string
  provider_metadata?: Record<string, unknown>
  watch_channel_id: string | null
  watch_last_message_number: number | null
  watch_resource_id: string | null
  watch_expiration: string | null
}

export interface BusyTime {
  start: string // ISO datetime
  end: string   // ISO datetime
}

export interface AvailableSlot {
  time: string  // HH:MM format
  available: boolean
}

export interface RemoteCalendarEvent {
  id: string
  status: string | null
  startDateTime: string | null
  endDateTime: string | null
}

export interface CalendarWatchRegistration {
  channelId: string
  resourceId: string
  expiration: string | null
}

const DEFAULT_WORKING_HOURS: CalendarConfig['working_hours'] = {
  mon: { start: '09:00', end: '18:00', enabled: true },
  tue: { start: '09:00', end: '18:00', enabled: true },
  wed: { start: '09:00', end: '18:00', enabled: true },
  thu: { start: '09:00', end: '18:00', enabled: true },
  fri: { start: '09:00', end: '18:00', enabled: true },
  sat: { start: '10:00', end: '16:00', enabled: true },
  sun: { start: '00:00', end: '00:00', enabled: false },
}

function normalizeTimeString(time: string): string {
  return time.split(':').slice(0, 2).join(':')
}

function localDateTimeString(date: string, time: string): string {
  return `${date}T${normalizeTimeString(time)}:00`
}

export function buildTourEventDateTimes(
  config: Pick<CalendarConfig, 'tour_duration_minutes' | 'timezone'>,
  tourDate: string,
  tourTime: string
): { startLocalDateTime: string; endLocalDateTime: string } {
  const start = zonedLocalDateTimeToDate(tourDate, tourTime, config.timezone)
  const end = new Date(start.getTime() + config.tour_duration_minutes * 60 * 1000)
  const endFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const endParts = endFormatter.formatToParts(end)
  const endLookup = Object.fromEntries(
    endParts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', string>

  return {
    startLocalDateTime: localDateTimeString(tourDate, tourTime),
    endLocalDateTime:
      `${endLookup.year}-${endLookup.month}-${endLookup.day}` +
      `T${endLookup.hour}:${endLookup.minute}:${endLookup.second}`,
  }
}

function getTimeZoneOffsetMs(timeZone: string, date: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  const parts = formatter.formatToParts(date)
  const lookup = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>

  const utcFromParts = Date.UTC(
    lookup.year,
    lookup.month - 1,
    lookup.day,
    lookup.hour,
    lookup.minute,
    lookup.second
  )

  return utcFromParts - date.getTime()
}

function zonedLocalDateTimeToDate(
  date: string,
  time: string,
  timeZone: string
): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = normalizeTimeString(time).split(':').map(Number)
  const utcGuess = Date.UTC(year, month - 1, day, hours, minutes, 0)

  let adjusted = utcGuess - getTimeZoneOffsetMs(timeZone, new Date(utcGuess))
  const secondOffset = getTimeZoneOffsetMs(timeZone, new Date(adjusted))
  adjusted = utcGuess - secondOffset

  return new Date(adjusted)
}

function normalizeCalendarConfig(config: CalendarConfigRow): CalendarConfig | null {
  if (
    !config.property_id ||
    (!config.google_email && !config.account_email) ||
    !config.access_token ||
    !config.refresh_token ||
    !config.token_expires_at
  ) {
    return null
  }

  return {
    id: config.id,
    property_id: config.property_id,
    provider: config.provider === 'microsoft' ? 'microsoft' : 'google',
    google_email: config.google_email || config.account_email || '',
    account_email: config.account_email || config.google_email || '',
    calendar_id: config.calendar_id || 'primary',
    access_token: config.access_token,
    refresh_token: config.refresh_token,
    token_expires_at: config.token_expires_at,
    working_hours: config.working_hours || DEFAULT_WORKING_HOURS,
    tour_duration_minutes: config.tour_duration_minutes || 30,
    buffer_minutes: config.buffer_minutes || 15,
    timezone: config.timezone || 'America/Chicago',
    token_status: config.token_status || 'healthy',
    provider_metadata: config.provider_metadata || {},
    watch_channel_id: config.watch_channel_id || null,
    watch_last_message_number: config.watch_last_message_number ?? null,
    watch_resource_id: config.watch_resource_id || null,
    watch_expiration: config.watch_expiration || null,
  }
}

function resolveCalendarWebhookUrl(): string | null {
  const explicitUrl = process.env.GOOGLE_CALENDAR_WEBHOOK_URL?.trim()
  if (explicitUrl) {
    return explicitUrl
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
    null
  if (!baseUrl) {
    return null
  }

  try {
    const webhookUrl = new URL('/api/lumaleasing/calendar/webhook', baseUrl)
    if (['localhost', '127.0.0.1'].includes(webhookUrl.hostname)) {
      return null
    }

    return webhookUrl.toString()
  } catch {
    return null
  }
}

export function shouldRenewCalendarWatch(
  config: Pick<CalendarConfig, 'watch_channel_id' | 'watch_resource_id' | 'watch_expiration'>
): boolean {
  if (!config.watch_channel_id || !config.watch_resource_id || !config.watch_expiration) {
    return true
  }

  const expirationMs = new Date(config.watch_expiration).getTime()
  if (!Number.isFinite(expirationMs)) {
    return true
  }

  return expirationMs - Date.now() < 24 * 60 * 60 * 1000
}

export async function setupCalendarWatch(
  config: CalendarConfig
): Promise<CalendarWatchRegistration | null> {
  if (config.provider !== 'google') {
    return null
  }

  const webhookUrl = resolveCalendarWebhookUrl()
  if (!webhookUrl) {
    return null
  }

  const { accessToken } = await refreshAccessTokenIfNeeded(config)
  const supabase = createServiceClient()

  try {
    const channelId = crypto.randomUUID()
    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(config.calendar_id)}/events/watch`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: channelId,
          type: 'web_hook',
          address: webhookUrl,
          params: {
            ttl: String(DEFAULT_CALENDAR_WATCH_TTL_SECONDS),
          },
        }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[GoogleCalendar] Setup watch failed:', errorText)

      if (response.status === 401) {
        const { accessToken: newToken } = await refreshAccessToken(config)
        return setupCalendarWatch({ ...config, access_token: newToken })
      }

      throw new Error(`Google Calendar watch error: ${response.status}`)
    }

    const data = await response.json()
    if (!data?.resourceId || typeof data.resourceId !== 'string') {
      throw new Error('Google Calendar watch response missing resourceId')
    }

    const expiration =
      typeof data.expiration === 'string' || typeof data.expiration === 'number'
        ? new Date(Number(data.expiration)).toISOString()
        : null

    const { error } = await supabase
      .from('agent_calendars')
      .update({
        watch_channel_id: channelId,
        watch_last_message_number: null,
        watch_resource_id: data.resourceId,
        watch_expiration: expiration,
        updated_at: new Date().toISOString(),
      })
      .eq('id', config.id)

    if (error) {
      throw error
    }

    return {
      channelId,
      resourceId: data.resourceId,
      expiration,
    }
  } catch (error) {
    console.error('[GoogleCalendar] Error setting up calendar watch:', error)
    throw error
  }
}

export async function ensureCalendarWatch(
  config: CalendarConfig
): Promise<CalendarWatchRegistration | null> {
  const webhookUrl = resolveCalendarWebhookUrl()
  if (!webhookUrl) {
    return null
  }

  if (!shouldRenewCalendarWatch(config)) {
    return {
      channelId: config.watch_channel_id!,
      resourceId: config.watch_resource_id!,
      expiration: config.watch_expiration,
    }
  }

  return setupCalendarWatch(config)
}

/**
 * Refresh access token if expired or expiring soon
 */
export async function refreshAccessTokenIfNeeded(
  config: CalendarConfig
): Promise<{ accessToken: string; expiresAt: string }> {
  const expiresAt = new Date(config.token_expires_at)
  const now = new Date()

  // If token expires in less than 5 minutes, refresh it
  if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    console.log('[GoogleCalendar] Token expiring soon, refreshing...')
    return await refreshAccessToken(config)
  }

  return {
    accessToken: config.access_token,
    expiresAt: config.token_expires_at,
  }
}

/**
 * Refresh the access token using refresh token
 */
async function refreshAccessToken(
  config: CalendarConfig
): Promise<{ accessToken: string; expiresAt: string }> {
  const supabase = createServiceClient()

  try {
    const isMicrosoft = config.provider === 'microsoft'
    const response = await fetch(isMicrosoft ? getMicrosoftTokenUrl() : GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: isMicrosoft
          ? process.env.MICROSOFT_CLIENT_ID || ''
          : process.env.GOOGLE_CLIENT_ID || '',
        client_secret: isMicrosoft
          ? process.env.MICROSOFT_CLIENT_SECRET || ''
          : process.env.GOOGLE_CLIENT_SECRET || '',
        refresh_token: config.refresh_token,
        grant_type: 'refresh_token',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[GoogleCalendar] Token refresh failed:', errorText)

      // Check if refresh token is revoked
      if (errorText.includes('invalid_grant')) {
        await supabase
          .from('agent_calendars')
          .update({
            token_status: 'revoked',
            health_check_error: 'Refresh token revoked by user',
            updated_at: new Date().toISOString(),
          })
          .eq('id', config.id)

        throw new Error('Calendar authorization revoked. Please reconnect.')
      }

      throw new Error('Failed to refresh token')
    }

    const tokens = await response.json()
    const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // Update database with new token
    await supabase
      .from('agent_calendars')
      .update({
        access_token: tokens.access_token,
        token_expires_at: newExpiresAt,
        token_status: 'healthy',
        last_health_check_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', config.id)

    // Log refresh for audit
    await supabase
      .from('calendar_token_refreshes')
      .insert({
        agent_calendar_id: config.id,
        refresh_status: 'success',
        old_expires_at: config.token_expires_at,
        new_expires_at: newExpiresAt,
      })

    return {
      accessToken: tokens.access_token,
      expiresAt: newExpiresAt,
    }
  } catch (error) {
    // Log failed refresh
    await supabase
      .from('calendar_token_refreshes')
      .insert({
        agent_calendar_id: config.id,
        refresh_status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        old_expires_at: config.token_expires_at,
      })

    throw error
  }
}

/**
 * Fetch busy times from Google Calendar
 */
export async function fetchBusyTimes(
  config: CalendarConfig,
  startDate: Date,
  endDate: Date
): Promise<BusyTime[]> {
  // Ensure token is fresh
  const { accessToken } = await refreshAccessTokenIfNeeded(config)

  if (config.provider === 'microsoft') {
    const response = await fetch(`${MICROSOFT_GRAPH_API}/me/calendar/getSchedule`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schedules: [config.account_email || config.google_email],
        startTime: {
          dateTime: startDate.toISOString(),
          timeZone: 'UTC',
        },
        endTime: {
          dateTime: endDate.toISOString(),
          timeZone: 'UTC',
        },
        availabilityViewInterval: config.tour_duration_minutes,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[MicrosoftCalendar] getSchedule API error:', errorText)

      if (response.status === 401) {
        const { accessToken: newToken } = await refreshAccessToken(config)
        return fetchBusyTimes({ ...config, access_token: newToken }, startDate, endDate)
      }

      throw new Error(`Microsoft Calendar API error: ${response.status}`)
    }

    const data = await response.json()
    const schedule = Array.isArray(data?.value) ? data.value[0] : null
    const items = Array.isArray(schedule?.scheduleItems) ? schedule.scheduleItems : []
    return items
      .filter((item: { status?: string }) => item.status !== 'free')
      .map((item: { start?: { dateTime?: string }, end?: { dateTime?: string } }) => ({
        start: item.start?.dateTime || '',
        end: item.end?.dateTime || '',
      }))
      .filter((item: BusyTime) => item.start && item.end)
  }

  // Call Google Calendar freebusy API
  const response = await fetch(`${GOOGLE_CALENDAR_API}/freeBusy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      items: [{ id: config.calendar_id }],
      timeZone: config.timezone,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[GoogleCalendar] Freebusy API error:', errorText)
    
    // If 401, token might be invalid
    if (response.status === 401) {
      // Try refreshing and retry once
      const { accessToken: newToken } = await refreshAccessToken(config)
      return fetchBusyTimes({ ...config, access_token: newToken }, startDate, endDate)
    }
    
    throw new Error(`Calendar API error: ${response.status}`)
  }

  const data = await response.json()
  const busyTimes: BusyTime[] = data.calendars[config.calendar_id]?.busy || []

  return busyTimes
}

/**
 * Generate available time slots based on working hours and busy times
 */
export function generateAvailableSlots(
  date: Date,
  config: CalendarConfig,
  busyTimes: BusyTime[]
): AvailableSlot[] {
  const dateStr = [
    date.getFullYear(),
    (date.getMonth() + 1).toString().padStart(2, '0'),
    date.getDate().toString().padStart(2, '0'),
  ].join('-')
  const dayOfWeek = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getDay()]
  const workingHours = config.working_hours[dayOfWeek]

  if (!workingHours || !workingHours.enabled) {
    return [] // Not a working day
  }

  const slots: AvailableSlot[] = []
  const [startHour, startMin] = workingHours.start.split(':').map(Number)
  const [endHour, endMin] = workingHours.end.split(':').map(Number)

  // Generate 30-minute slots (or tour_duration_minutes)
  const slotDuration = config.tour_duration_minutes
  let currentMinutes = startHour * 60 + startMin

  const endMinutes = endHour * 60 + endMin
  
  while (currentMinutes + slotDuration <= endMinutes) {
    const hour = Math.floor(currentMinutes / 60)
    const minute = currentMinutes % 60
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
    
    // Check if this slot conflicts with busy times
    const slotStart = zonedLocalDateTimeToDate(dateStr, timeStr, config.timezone)
    
    const slotEnd = new Date(slotStart)
    slotEnd.setMinutes(slotEnd.getMinutes() + slotDuration + config.buffer_minutes)

    const isAvailable = !busyTimes.some(busy => {
      const busyStart = new Date(busy.start)
      const busyEnd = new Date(busy.end)
      
      // Check for overlap
      return (
        (slotStart >= busyStart && slotStart < busyEnd) ||
        (slotEnd > busyStart && slotEnd <= busyEnd) ||
        (slotStart <= busyStart && slotEnd >= busyEnd)
      )
    })

    slots.push({
      time: timeStr,
      available: isAvailable,
    })

    currentMinutes += slotDuration
  }

  return slots
}

/**
 * Create a Google Calendar event for a tour booking
 */
export async function createCalendarEvent(
  config: CalendarConfig,
  tourDetails: {
    propertyName: string
    prospectName: string
    prospectEmail: string
    prospectPhone?: string
    tourDate: string // YYYY-MM-DD
    tourTime: string // HH:MM
    specialRequests?: string
    propertyAddress?: string
  }
): Promise<{ eventId: string; htmlLink: string }> {
  // Ensure token is fresh
  const { accessToken } = await refreshAccessTokenIfNeeded(config)

  const { startLocalDateTime, endLocalDateTime } = buildTourEventDateTimes(
    config,
    tourDetails.tourDate,
    tourDetails.tourTime
  )

  // Format description
  let description = `Property Tour with ${tourDetails.prospectName}\n\n`
  description += `Contact: ${tourDetails.prospectEmail}`
  if (tourDetails.prospectPhone) {
    description += ` | ${tourDetails.prospectPhone}`
  }
  if (tourDetails.specialRequests) {
    description += `\n\nSpecial Requests: ${tourDetails.specialRequests}`
  }
  description += `\n\nBooked via LumaLeasing widget`

  if (config.provider === 'microsoft') {
    const createOnlineMeeting = config.provider_metadata?.teams_meeting_enabled === true
    const response = await fetch(`${MICROSOFT_GRAPH_API}/me/calendar/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subject: `Tour - ${tourDetails.propertyName}`,
        body: {
          contentType: 'text',
          content: description,
        },
        location: {
          displayName: tourDetails.propertyAddress || '',
        },
        start: {
          dateTime: startLocalDateTime,
          timeZone: config.timezone,
        },
        end: {
          dateTime: endLocalDateTime,
          timeZone: config.timezone,
        },
        attendees: [
          {
            emailAddress: {
              address: tourDetails.prospectEmail,
              name: tourDetails.prospectName,
            },
            type: 'required',
          },
        ],
        ...(createOnlineMeeting
          ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' }
          : {}),
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[MicrosoftCalendar] Event creation failed:', errorText)

      if (response.status === 401) {
        const { accessToken: newToken } = await refreshAccessToken(config)
        return createCalendarEvent({ ...config, access_token: newToken }, tourDetails)
      }

      throw new Error(`Failed to create Microsoft calendar event: ${response.status}`)
    }

    const event = await response.json()
    return {
      eventId: event.id,
      htmlLink: event.webLink || event.onlineMeeting?.joinUrl || '',
    }
  }

  // Create event
  const response = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${config.calendar_id}/events`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary: `Tour - ${tourDetails.propertyName}`,
      description,
      location: tourDetails.propertyAddress || '',
      start: {
        dateTime: startLocalDateTime,
        timeZone: config.timezone,
      },
      end: {
        dateTime: endLocalDateTime,
        timeZone: config.timezone,
      },
      attendees: [
        { email: tourDetails.prospectEmail }
      ],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 1440 }, // 24hr
          { method: 'email', minutes: 60 }    // 1hr
        ]
      },
      guestsCanModify: false,
      guestsCanInviteOthers: false,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[GoogleCalendar] Event creation failed:', errorText)
    
    // Retry once if 401
    if (response.status === 401) {
      const { accessToken: newToken } = await refreshAccessToken(config)
      return createCalendarEvent({ ...config, access_token: newToken }, tourDetails)
    }
    
    throw new Error(`Failed to create calendar event: ${response.status}`)
  }

  const event = await response.json()
  
  return {
    eventId: event.id,
    htmlLink: event.htmlLink,
  }
}

/**
 * Update an existing Google Calendar event for a tour booking.
 */
export async function updateCalendarEvent(
  config: CalendarConfig,
  googleEventId: string,
  tourDetails: {
    propertyName: string
    prospectName: string
    prospectEmail: string
    prospectPhone?: string
    tourDate: string // YYYY-MM-DD
    tourTime: string // HH:MM
    specialRequests?: string
    propertyAddress?: string
  }
): Promise<{ eventId: string; htmlLink: string }> {
  const { accessToken } = await refreshAccessTokenIfNeeded(config)

  const { startLocalDateTime, endLocalDateTime } = buildTourEventDateTimes(
    config,
    tourDetails.tourDate,
    tourDetails.tourTime
  )

  let description = `Property Tour with ${tourDetails.prospectName}\n\n`
  description += `Contact: ${tourDetails.prospectEmail}`
  if (tourDetails.prospectPhone) {
    description += ` | ${tourDetails.prospectPhone}`
  }
  if (tourDetails.specialRequests) {
    description += `\n\nSpecial Requests: ${tourDetails.specialRequests}`
  }
  description += `\n\nBooked via LumaLeasing widget`

  if (config.provider === 'microsoft') {
    const response = await fetch(`${MICROSOFT_GRAPH_API}/me/events/${googleEventId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subject: `Tour - ${tourDetails.propertyName}`,
        body: {
          contentType: 'text',
          content: description,
        },
        location: {
          displayName: tourDetails.propertyAddress || '',
        },
        start: {
          dateTime: startLocalDateTime,
          timeZone: config.timezone,
        },
        end: {
          dateTime: endLocalDateTime,
          timeZone: config.timezone,
        },
        attendees: [
          {
            emailAddress: {
              address: tourDetails.prospectEmail,
              name: tourDetails.prospectName,
            },
            type: 'required',
          },
        ],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[MicrosoftCalendar] Event update failed:', errorText)

      if (response.status === 401) {
        const { accessToken: newToken } = await refreshAccessToken(config)
        return updateCalendarEvent({ ...config, access_token: newToken }, googleEventId, tourDetails)
      }

      throw new Error(`Failed to update Microsoft calendar event: ${response.status}`)
    }

    const event = await response.json()
    return {
      eventId: event.id || googleEventId,
      htmlLink: event.webLink || event.onlineMeeting?.joinUrl || '',
    }
  }

  const response = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${config.calendar_id}/events/${googleEventId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: `Tour - ${tourDetails.propertyName}`,
        description,
        location: tourDetails.propertyAddress || '',
        start: {
          dateTime: startLocalDateTime,
          timeZone: config.timezone,
        },
        end: {
          dateTime: endLocalDateTime,
          timeZone: config.timezone,
        },
        attendees: [{ email: tourDetails.prospectEmail }],
        guestsCanModify: false,
        guestsCanInviteOthers: false,
      }),
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[GoogleCalendar] Event update failed:', errorText)

    if (response.status === 401) {
      const { accessToken: newToken } = await refreshAccessToken(config)
      return updateCalendarEvent({ ...config, access_token: newToken }, googleEventId, tourDetails)
    }

    throw new Error(`Failed to update calendar event: ${response.status}`)
  }

  const event = await response.json()
  return {
    eventId: event.id,
    htmlLink: event.htmlLink,
  }
}

export async function getCalendarEvent(
  config: CalendarConfig,
  googleEventId: string
): Promise<RemoteCalendarEvent | null> {
  const { accessToken } = await refreshAccessTokenIfNeeded(config)

  if (config.provider === 'microsoft') {
    const response = await fetch(`${MICROSOFT_GRAPH_API}/me/events/${googleEventId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (response.status === 404 || response.status === 410) {
      return null
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[MicrosoftCalendar] Event fetch failed:', errorText)

      if (response.status === 401) {
        const { accessToken: newToken } = await refreshAccessToken(config)
        return getCalendarEvent({ ...config, access_token: newToken }, googleEventId)
      }

      throw new Error(`Failed to fetch Microsoft calendar event: ${response.status}`)
    }

    const event = await response.json()
    return {
      id: typeof event.id === 'string' ? event.id : googleEventId,
      status: typeof event.isCancelled === 'boolean' && event.isCancelled ? 'cancelled' : 'confirmed',
      startDateTime:
        typeof event.start?.dateTime === 'string' ? event.start.dateTime : null,
      endDateTime:
        typeof event.end?.dateTime === 'string' ? event.end.dateTime : null,
    }
  }

  const response = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${config.calendar_id}/events/${googleEventId}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  if (response.status === 404 || response.status === 410) {
    return null
  }

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[GoogleCalendar] Event fetch failed:', errorText)

    if (response.status === 401) {
      const { accessToken: newToken } = await refreshAccessToken(config)
      return getCalendarEvent({ ...config, access_token: newToken }, googleEventId)
    }

    throw new Error(`Failed to fetch calendar event: ${response.status}`)
  }

  const event = await response.json()
  return {
    id: typeof event.id === 'string' ? event.id : googleEventId,
    status: typeof event.status === 'string' ? event.status : null,
    startDateTime:
      typeof event.start?.dateTime === 'string' ? event.start.dateTime : null,
    endDateTime:
      typeof event.end?.dateTime === 'string' ? event.end.dateTime : null,
  }
}

/**
 * Cancel (delete) an existing Google Calendar event.
 */
export async function cancelCalendarEvent(
  config: CalendarConfig,
  googleEventId: string
): Promise<void> {
  const { accessToken } = await refreshAccessTokenIfNeeded(config)

  if (config.provider === 'microsoft') {
    const response = await fetch(`${MICROSOFT_GRAPH_API}/me/events/${googleEventId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (response.ok || response.status === 404 || response.status === 410) {
      return
    }

    const errorText = await response.text()
    console.error('[MicrosoftCalendar] Event delete failed:', errorText)

    if (response.status === 401) {
      const { accessToken: newToken } = await refreshAccessToken(config)
      await cancelCalendarEvent({ ...config, access_token: newToken }, googleEventId)
      return
    }

    throw new Error(`Failed to cancel Microsoft calendar event: ${response.status}`)
  }

  const response = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${config.calendar_id}/events/${googleEventId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  if (response.ok || response.status === 404 || response.status === 410) {
    return
  }

  const errorText = await response.text()
  console.error('[GoogleCalendar] Event delete failed:', errorText)

  if (response.status === 401) {
    const { accessToken: newToken } = await refreshAccessToken(config)
    await cancelCalendarEvent({ ...config, access_token: newToken }, googleEventId)
    return
  }

  throw new Error(`Failed to cancel calendar event: ${response.status}`)
}

/**
 * Get calendar configuration for a property
 */
export async function getCalendarConfig(propertyId: string): Promise<CalendarConfig | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('agent_calendars')
    .select('*')
    .eq('property_id', propertyId)
    .eq('sync_enabled', true)
    .single()

  if (error || !data) {
    return null
  }

  return normalizeCalendarConfig(data as CalendarConfigRow)
}
