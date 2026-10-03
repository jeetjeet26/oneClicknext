import { calendarDateTimeInstant, validCalendarDay } from './calendar-time'
import { normalizeTimezoneToIana, resolveCalendarTimezone } from './timezone'
import { requireDeliveryEnabled } from './delivery-guard'
/**
 * Google Calendar API Utility
 * Handles token refresh, API calls, and availability generation
 */

import {renewCalendarCredentials} from './calendar-credentials'
import { createServiceClient } from '@/utils/supabase/admin'
import crypto from 'crypto'

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const MICROSOFT_GRAPH_API = 'https://graph.microsoft.com/v1.0'
const DEFAULT_CALENDAR_WATCH_TTL_SECONDS = 60 * 60 * 24 * 7

interface CalendarConfigRow {
  credential_version?:number
  provider_subject?:string|null
  tenant_id?:string|null
  properties?: {settings?: {timezone?: string} | null} | null
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
  credential_version?:number
  provider_subject?:string|null
  tenant_id?:string|null
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
): { startLocalDateTime: string; endLocalDateTime: string; startInstant: string; endInstant: string } {
  const start = zonedLocalDateTimeToDate(tourDate, tourTime, config.timezone)
  const end = new Date(start.getTime() + config.tour_duration_minutes * 60 * 1000)
  const endFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    hourCycle: 'h23',
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
    startInstant: start.toISOString(),
    endInstant: end.toISOString(),
    startLocalDateTime: localDateTimeString(tourDate, tourTime),
    endLocalDateTime:
      `${endLookup.year}-${endLookup.month}-${endLookup.day}` +
      `T${endLookup.hour}:${endLookup.minute}:${endLookup.second}`,
  }
}

function zonedLocalDateTimeToDate(date: string, time: string, timeZone: string): Date {
  const instant = calendarDateTimeInstant(localDateTimeString(date, time), timeZone)
  if (!instant) throw new Error('Tour time or timezone is invalid or ambiguous')
  return new Date(instant)
}

function normalizeCalendarConfig(config: CalendarConfigRow): CalendarConfig | null {
  if (
    !config.property_id ||
    (!config.google_email && !config.account_email) ||
    !config.access_token ||
    !config.refresh_token ||
    !config.token_expires_at
  ) {
    throw new Error('Calendar connection is incomplete')
  }
  const timezone = resolveCalendarTimezone(config.properties?.settings, config.timezone)
  if (!timezone) throw new Error('Calendar timezone needs configuration')

  return {
    id: config.id,
    credential_version:config.credential_version,
    provider_subject:config.provider_subject,
    tenant_id:config.tenant_id,
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
    buffer_minutes: config.buffer_minutes ?? 15,
    timezone,
    token_status: config.token_status || 'unknown',
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
  config: CalendarConfig,
  retried = false
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
        signal: AbortSignal.timeout(20_000),
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
      console.error('[GoogleCalendar] Setup watch failed:', response.status)

      if (response.status === 401 && !retried) {
        const { accessToken: newToken, expiresAt: newExpiresAt } = await refreshAccessToken(config)
        return setupCalendarWatch({ ...config, access_token: newToken, token_expires_at: newExpiresAt },true)
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

    if (!expiration || !Number.isFinite(Date.parse(expiration)) || Date.parse(expiration)<=Date.now()) throw new Error('Calendar watch expiry could not be confirmed.')

    const { data: savedWatch, error } = await supabase
      .from('agent_calendars')
      .update({
        watch_channel_id: channelId,
        watch_last_message_number: null,
        watch_resource_id: data.resourceId,
        watch_expiration: expiration,
        updated_at: new Date().toISOString(),
      })
      .eq('id', config.id)
      .eq('property_id', config.property_id)
      .eq('credential_version', config.credential_version!)
      .eq('sync_enabled', true)
      .is('retired_at', null)
      .select('id')
      .maybeSingle()

    if (error || !savedWatch) {
      throw new Error('Calendar watch could not be saved because the connection changed or is unavailable.')
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
  return renewCalendarCredentials(config)
}

/**
 * Refresh the access token using refresh token
 */
async function refreshAccessToken(config:CalendarConfig):Promise<{accessToken:string;expiresAt:string}> {
  return renewCalendarCredentials(config,true)
}

/**
 * Fetch busy times from Google Calendar
 */
function busyInterval(startValue: unknown, endValue: unknown, startZone?: string, endZone?: string): BusyTime {
  const start = calendarDateTimeInstant(startValue, startZone)
  const end = calendarDateTimeInstant(endValue, endZone)
  if (!start || !end || Date.parse(start) >= Date.parse(end)) throw new Error('Calendar returned an invalid busy interval')
  return {start, end}
}

export async function fetchBusyTimes(
  config: CalendarConfig,
  startDate: Date,
  endDate: Date,
  refreshed = false
): Promise<BusyTime[]> {
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || startDate >= endDate) {
    throw new Error('Invalid availability interval')
  }
  const {accessToken} = await refreshAccessTokenIfNeeded(config)
  const microsoft = config.provider === 'microsoft'
  const mailbox = config.account_email || config.google_email
  const response = await fetch(microsoft ? `${MICROSOFT_GRAPH_API}/me/calendar/getSchedule` : `${GOOGLE_CALENDAR_API}/freeBusy`, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json',
      ...(microsoft ? {Prefer: 'outlook.timezone="UTC"'} : {}),
    },
    body: JSON.stringify(microsoft ? {
      schedules: [mailbox],
      startTime: {dateTime: startDate.toISOString(), timeZone: 'UTC'},
      endTime: {dateTime: endDate.toISOString(), timeZone: 'UTC'},
      availabilityViewInterval: 30,
    } : {timeMin: startDate.toISOString(), timeMax: endDate.toISOString(), items: [{id: config.calendar_id}], timeZone: 'UTC'}),
  })
  if (!response.ok) {
    if (response.status === 401 && !refreshed) {
      const fresh = await refreshAccessToken(config)
      return fetchBusyTimes({...config, access_token: fresh.accessToken, token_expires_at: fresh.expiresAt}, startDate, endDate, true)
    }
    throw new Error(`Calendar availability read failed: ${response.status}`)
  }
  const data = await response.json()
  if (microsoft) {
    const schedules = Array.isArray(data?.value) ? data.value.filter((row: {scheduleId?: string}) =>
      typeof row?.scheduleId === 'string' && row.scheduleId.toLowerCase() === mailbox.toLowerCase()) : []
    if (schedules.length !== 1 || schedules[0].error || !Array.isArray(schedules[0].scheduleItems)) {
      throw new Error('Calendar returned incomplete mailbox availability')
    }
    return schedules[0].scheduleItems.flatMap((item: {status?: string; start?: {dateTime?: string; timeZone?: string}; end?: {dateTime?: string; timeZone?: string}}) => {
      if (!item || !['free', 'tentative', 'busy', 'oof', 'workingElsewhere', 'unknown'].includes(item.status || '')) {
        throw new Error('Calendar returned an unknown availability state')
      }
      // Conservative policy: only explicitly free events release the time.
      if (item.status === 'free') return []
      return [busyInterval(item.start?.dateTime, item.end?.dateTime, item.start?.timeZone, item.end?.timeZone)]
    })
  }
  const calendar = data?.calendars?.[config.calendar_id]
  if (!calendar || (calendar.errors && (!Array.isArray(calendar.errors) || calendar.errors.length)) || !Array.isArray(calendar.busy)) {
    throw new Error('Calendar returned incomplete availability')
  }
  return calendar.busy.map((item: {start?: string; end?: string}) => busyInterval(item?.start, item?.end))
}

/** Slots use explicit property date labels and elapsed durations, independent of server timezone. */
export function generateAvailableSlots(
  date: string,
  config: CalendarConfig,
  busyTimes: BusyTime[],
  now = new Date()
): AvailableSlot[] {
  if (!validCalendarDay(date) || !normalizeTimezoneToIana(config.timezone)) throw new Error('Calendar date or timezone needs review')
  const duration = config.tour_duration_minutes, buffer = config.buffer_minutes
  if (!Number.isInteger(duration) || duration < 5 || duration > 240 || !Number.isInteger(buffer) || buffer < 0 || buffer > 240) {
    throw new Error('Tour duration or buffer needs configuration')
  }
  const dayOfWeek = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${date}T00:00:00Z`).getUTCDay()]
  const hours = config.working_hours[dayOfWeek]
  if (!hours || !hours.enabled) return []
  const minutes = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN
  const first = minutes(hours.start), last = minutes(hours.end)
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) throw new Error('Working hours need configuration')
  const busy = busyTimes.map(item => busyInterval(item.start, item.end)).map(item => ({start: Date.parse(item.start), end: Date.parse(item.end)}))
  const slots: AvailableSlot[] = []
  for (let at = first; at + duration <= last; at += duration) {
    const time = `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`
    const start = calendarDateTimeInstant(`${date}T${time}:00`, config.timezone)
    const startMs = start ? Date.parse(start) : NaN
    const endMs = startMs + duration * 60000
    const closing = calendarDateTimeInstant(`${date}T${hours.end}:00`, config.timezone)
    slots.push({time, available: Boolean(start && closing) && startMs > now.getTime() && endMs <= Date.parse(closing!) &&
      !busy.some(item => startMs < item.end + buffer * 60000 && endMs + buffer * 60000 > item.start)})
  }
  return slots
}

/**
 * Create a Google Calendar event for a tour booking
 */
export async function createCalendarEvent(
  config: CalendarConfig,
  tourDetails: {
    requestId?: string
    propertyName: string
    prospectName: string
    prospectEmail: string
    prospectPhone?: string
    tourDate: string // YYYY-MM-DD
    tourTime: string // HH:MM
    specialRequests?: string
    propertyAddress?: string
  },
  refreshed = false
): Promise<{ eventId: string; htmlLink: string }> {
  requireDeliveryEnabled()
  const rawIdentity = tourDetails.requestId?.replace(/-/g, '')
  const eventIdentity = rawIdentity ? (/^[0-9a-f]{32}$/.test(rawIdentity) ? rawIdentity : crypto.createHash('sha256').update(tourDetails.requestId!).digest('hex')) : undefined
  // Ensure token is fresh
  const { accessToken } = await refreshAccessTokenIfNeeded(config)

  const { startInstant, endInstant } = buildTourEventDateTimes(
    config,
    tourDetails.tourDate,
    tourDetails.tourTime
  )
  const eventStart = config.provider === 'microsoft' ? startInstant.slice(0, -1) : startInstant
  const eventEnd = config.provider === 'microsoft' ? endInstant.slice(0, -1) : endInstant
  const eventZone = config.provider === 'microsoft' ? 'UTC' : config.timezone

  // Format description
  let description = `Property Tour with ${tourDetails.prospectName}\n\n`
  description += `Contact: ${tourDetails.prospectEmail}`
  if (tourDetails.prospectPhone) {
    description += ` | ${tourDetails.prospectPhone}`
  }
  if (tourDetails.specialRequests) {
    description += `\n\nSpecial Requests: ${tourDetails.specialRequests}`
  }

  if (config.provider === 'microsoft') {
    const createOnlineMeeting = config.provider_metadata?.teams_meeting_enabled === true
    const response = await fetch(`${MICROSOFT_GRAPH_API}/me/calendar/events`, {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...(tourDetails.requestId ? {transactionId:tourDetails.requestId} : {}),
        subject: `Tour - ${tourDetails.propertyName}`,
        body: {
          contentType: 'text',
          content: description,
        },
        location: {
          displayName: tourDetails.propertyAddress || '',
        },
        start: {
          dateTime: eventStart,
          timeZone: eventZone,
        },
        end: {
          dateTime: eventEnd,
          timeZone: eventZone,
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

      if (response.status === 401 && !refreshed) {
        const { accessToken: newToken, expiresAt: newExpiresAt } = await refreshAccessToken(config)
        return createCalendarEvent({ ...config, access_token: newToken, token_expires_at: newExpiresAt }, tourDetails, true)
      }

      throw new Error(`Failed to create Microsoft calendar event: ${response.status}`)
    }

    const event = await response.json()
    if (!event.id) throw new Error('Calendar acceptance was not confirmed')
    return {
      eventId: event.id,
      htmlLink: event.webLink || event.onlineMeeting?.joinUrl || '',
    }
  }

  // Create event
  const response = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(config.calendar_id)}/events`, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(tourDetails.requestId ? {id:eventIdentity} : {}),
      summary: `Tour - ${tourDetails.propertyName}`,
      description,
      location: tourDetails.propertyAddress || '',
      start: {
        dateTime: eventStart,
        timeZone: eventZone,
      },
      end: {
        dateTime: eventEnd,
        timeZone: eventZone,
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

  if (response.status === 409 && tourDetails.requestId) {
    const lookup = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(config.calendar_id)}/events/${eventIdentity}`, {
      headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(15000)})
    if (!lookup.ok) throw new Error('Could not reconcile existing calendar event')
    const existing = await lookup.json()
    if (existing.id !== eventIdentity || existing.status==='cancelled' || calendarDateTimeInstant(existing.start?.dateTime, existing.start?.timeZone) !== startInstant || calendarDateTimeInstant(existing.end?.dateTime, existing.end?.timeZone) !== endInstant) throw new Error('Existing calendar event needs review')
    return {eventId:existing.id,htmlLink:existing.htmlLink || ''}
  }
  if (!response.ok) {
    const errorText = await response.text()
    console.error('[GoogleCalendar] Event creation failed:', errorText)
    
    // Retry once if 401
    if (response.status === 401 && !refreshed) {
      const { accessToken: newToken, expiresAt: newExpiresAt } = await refreshAccessToken(config)
      return createCalendarEvent({ ...config, access_token: newToken, token_expires_at: newExpiresAt }, tourDetails, true)
    }
    
    throw new Error(`Failed to create calendar event: ${response.status}`)
  }

  const event = await response.json()
  
  if (!event.id) throw new Error('Calendar acceptance was not confirmed')
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
  },
  refreshed = false
): Promise<{ eventId: string; htmlLink: string }> {
  requireDeliveryEnabled()
  const { accessToken } = await refreshAccessTokenIfNeeded(config)

  const { startInstant, endInstant } = buildTourEventDateTimes(
    config,
    tourDetails.tourDate,
    tourDetails.tourTime
  )
  const eventStart = config.provider === 'microsoft' ? startInstant.slice(0, -1) : startInstant
  const eventEnd = config.provider === 'microsoft' ? endInstant.slice(0, -1) : endInstant
  const eventZone = config.provider === 'microsoft' ? 'UTC' : config.timezone

  let description = `Property Tour with ${tourDetails.prospectName}\n\n`
  description += `Contact: ${tourDetails.prospectEmail}`
  if (tourDetails.prospectPhone) {
    description += ` | ${tourDetails.prospectPhone}`
  }
  if (tourDetails.specialRequests) {
    description += `\n\nSpecial Requests: ${tourDetails.specialRequests}`
  }

  if (config.provider === 'microsoft') {
    const response = await fetch(`${MICROSOFT_GRAPH_API}/me/events/${encodeURIComponent(googleEventId)}`, {
      method: 'PATCH',
      signal: AbortSignal.timeout(20000),
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
          dateTime: eventStart,
          timeZone: eventZone,
        },
        end: {
          dateTime: eventEnd,
          timeZone: eventZone,
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

      if (response.status === 401 && !refreshed) {
        const { accessToken: newToken, expiresAt: newExpiresAt } = await refreshAccessToken(config)
        return updateCalendarEvent({ ...config, access_token: newToken, token_expires_at: newExpiresAt }, googleEventId, tourDetails, true)
      }

      throw new Error(`Failed to update Microsoft calendar event: ${response.status}`)
    }

    const event = await response.json()
    if (event.id !== googleEventId) throw new Error('Calendar update acceptance was not confirmed')
    return {
      eventId: event.id || googleEventId,
      htmlLink: event.webLink || event.onlineMeeting?.joinUrl || '',
    }
  }

  const response = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(config.calendar_id)}/events/${encodeURIComponent(googleEventId)}`,
    {
      method: 'PATCH',
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: `Tour - ${tourDetails.propertyName}`,
        description,
        location: tourDetails.propertyAddress || '',
        start: {
          dateTime: eventStart,
          timeZone: eventZone,
        },
        end: {
          dateTime: eventEnd,
          timeZone: eventZone,
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

    if (response.status === 401 && !refreshed) {
      const { accessToken: newToken, expiresAt: newExpiresAt } = await refreshAccessToken(config)
      return updateCalendarEvent({ ...config, access_token: newToken, token_expires_at: newExpiresAt }, googleEventId, tourDetails, true)
    }

    throw new Error(`Failed to update calendar event: ${response.status}`)
  }

  const event = await response.json()
  if (event.id !== googleEventId) throw new Error('Calendar update acceptance was not confirmed')
  return {
    eventId: event.id,
    htmlLink: event.htmlLink,
  }
}

export async function getCalendarEvent(
  config: CalendarConfig,
  googleEventId: string,
  refreshed = false
): Promise<RemoteCalendarEvent | null> {
  const { accessToken } = await refreshAccessTokenIfNeeded(config)

  if (config.provider === 'microsoft') {
    const response = await fetch(`${MICROSOFT_GRAPH_API}/me/events/${encodeURIComponent(googleEventId)}`, {
      method: 'GET',
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    })

    if (response.status === 404 || response.status === 410) {
      return null
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[MicrosoftCalendar] Event fetch failed:', errorText)

      if (response.status === 401 && !refreshed) {
        const { accessToken: newToken, expiresAt: newExpiresAt } = await refreshAccessToken(config)
        return getCalendarEvent({ ...config, access_token: newToken, token_expires_at: newExpiresAt }, googleEventId, true)
      }

      throw new Error(`Failed to fetch Microsoft calendar event: ${response.status}`)
    }

    const event = await response.json()
    return {
      id: typeof event.id === 'string' ? event.id : googleEventId,
      status: typeof event.isCancelled === 'boolean' && event.isCancelled ? 'cancelled' : 'confirmed',
      startDateTime:
        calendarDateTimeInstant(event.start?.dateTime,event.start?.timeZone),
      endDateTime:
        calendarDateTimeInstant(event.end?.dateTime,event.end?.timeZone),
    }
  }

  const response = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(config.calendar_id)}/events/${encodeURIComponent(googleEventId)}`,
    {
      method: 'GET',
      signal: AbortSignal.timeout(20000),
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

    if (response.status === 401 && !refreshed) {
      const { accessToken: newToken, expiresAt: newExpiresAt } = await refreshAccessToken(config)
      return getCalendarEvent({ ...config, access_token: newToken, token_expires_at: newExpiresAt }, googleEventId, true)
    }

    throw new Error(`Failed to fetch calendar event: ${response.status}`)
  }

  const event = await response.json()
  return {
    id: typeof event.id === 'string' ? event.id : googleEventId,
    status: typeof event.status === 'string' ? event.status : null,
    startDateTime:
      calendarDateTimeInstant(event.start?.dateTime,event.start?.timeZone),
    endDateTime:
      calendarDateTimeInstant(event.end?.dateTime,event.end?.timeZone),
  }
}

/**
 * Cancel (delete) an existing Google Calendar event.
 */
export async function cancelCalendarEvent(
  config: CalendarConfig,
  googleEventId: string,
  refreshed = false
): Promise<void> {
  requireDeliveryEnabled()
  const { accessToken } = await refreshAccessTokenIfNeeded(config)

  if (config.provider === 'microsoft') {
    const response = await fetch(`${MICROSOFT_GRAPH_API}/me/events/${encodeURIComponent(googleEventId)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (response.ok || response.status === 404 || response.status === 410) {
      return
    }

    const errorText = await response.text()
    console.error('[MicrosoftCalendar] Event delete failed:', errorText)

    if (response.status === 401 && !refreshed) {
      const { accessToken: newToken, expiresAt: newExpiresAt } = await refreshAccessToken(config)
      await cancelCalendarEvent({ ...config, access_token: newToken, token_expires_at: newExpiresAt }, googleEventId, true)
      return
    }

    throw new Error(`Failed to cancel Microsoft calendar event: ${response.status}`)
  }

  const response = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(config.calendar_id)}/events/${encodeURIComponent(googleEventId)}`,
    {
      method: 'DELETE',
      signal: AbortSignal.timeout(20000),
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

  if (response.status === 401 && !refreshed) {
    const { accessToken: newToken, expiresAt: newExpiresAt } = await refreshAccessToken(config)
    await cancelCalendarEvent({ ...config, access_token: newToken, token_expires_at: newExpiresAt }, googleEventId, true)
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
    .select('*, properties(settings)')
    .eq('property_id', propertyId)
    .eq('sync_enabled', true)
    .maybeSingle()

  if (error) throw new Error('Calendar configuration could not be read')
  if (!data) return null

  return normalizeCalendarConfig(data as CalendarConfigRow)
}
