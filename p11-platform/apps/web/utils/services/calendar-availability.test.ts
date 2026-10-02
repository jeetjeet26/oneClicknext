import {afterEach, beforeEach, expect, it, vi} from 'vitest'
const d = vi.hoisted(() => ({fetch: vi.fn(), row: {} as Record<string, unknown>, error: null as unknown}))
vi.mock('@/utils/supabase/admin', () => ({createServiceClient: () => ({rpc:async(name:string,args:Record<string,unknown>)=>({data:name==='claim_calendar_token_refresh'?(args.p_force?{state:'claimed',refreshToken:'fixture'}:{state:'ready',permissionState:'confirmed',accessToken:'fixture',refreshToken:'fixture',expiresAt:'2099-01-01',version:1}):{state:'saved',permissionState:'confirmed',accessToken:(args.p_tokens as Record<string,string>).accessToken,refreshToken:'fixture',expiresAt:(args.p_tokens as Record<string,string>).expiresAt,version:2}}),from: () => {
  const q = {select: () => q, eq: () => q, update: () => q, insert: () => q,
    maybeSingle: async () => ({data: d.row, error: d.error}), then: (resolve: (value: unknown) => void) => resolve({data: null, error: null})}
  return q
}})}))
import {fetchBusyTimes, generateAvailableSlots, getCalendarConfig, type CalendarConfig} from './google-calendar'
import {addCalendarDays, calendarDayRange, calendarToday} from './calendar-time'
import {generateTourCalendarResponse} from './calendar-invite'
const hours = {start: '09:00', end: '12:00', enabled: true}
const config = {credential_version:1,id: 'calendar', property_id: 'property', provider: 'google', google_email: 'leasing@example.com', account_email: 'leasing@example.com', calendar_id: 'primary', access_token: 'fixture', refresh_token: 'fixture', token_expires_at: '2099-01-01', timezone: 'America/New_York', token_status: 'healthy', tour_duration_minutes: 30, buffer_minutes: 0, working_hours: {mon: hours, sun: hours}, watch_channel_id: null, watch_resource_id: null, watch_expiration: null, watch_last_message_number: null} satisfies CalendarConfig
const first = new Date('2026-03-09T00:00:00Z'), last = new Date('2026-03-10T00:00:00Z'), before = new Date('2026-01-01T00:00:00Z')
const ok = (body: unknown) => ({ok: true, json: async () => body})
beforeEach(() => {vi.resetAllMocks(); vi.stubGlobal('fetch', d.fetch); d.row = {...config}; d.error = null})
afterEach(() => {vi.unstubAllGlobals(); vi.unstubAllEnvs()})

it.each([
  {}, {calendars: {}}, {calendars: {primary: {errors: [{reason: 'notFound'}], busy: []}}},
  {calendars: {primary: {}}}, {calendars: {primary: {busy: [{start: 'invalid', end: 'invalid'}]}}},
  {calendars: {primary: {busy: [{start: '2026-03-09T12:00:00Z', end: '2026-03-09T11:00:00Z'}]}}},
])('never treats an incomplete Google calendar response as free (%j)', async body => {
  d.fetch.mockResolvedValue(ok(body)); await expect(fetchBusyTimes(config, first, last)).rejects.toThrow()
})
it('accepts explicitly empty Google availability and normalizes offset intervals', async () => {
  d.fetch.mockResolvedValueOnce(ok({calendars: {primary: {busy: []}}})).mockResolvedValueOnce(ok({calendars: {primary: {busy: [{start: '2026-03-09T09:00:00-04:00', end: '2026-03-09T10:00:00-04:00'}]}}}))
  expect(await fetchBusyTimes(config, first, last)).toEqual([])
  expect(await fetchBusyTimes(config, first, last)).toEqual([{start: '2026-03-09T13:00:00.000Z', end: '2026-03-09T14:00:00.000Z'}])
})
it.each([{}, {value: []}, {value: [{scheduleId: 'other@example.com', scheduleItems: []}]},
  {value: [{scheduleId: 'leasing@example.com', error: {message: 'No access'}, scheduleItems: []}]},
  {value: [{scheduleId: 'leasing@example.com'}]},
  {value: [{scheduleId: 'leasing@example.com', scheduleItems: [{status: 'busy'}]}]},
])('never treats an incomplete Microsoft response as free (%j)', async body => {
  d.fetch.mockResolvedValue(ok(body)); await expect(fetchBusyTimes({...config, provider: 'microsoft'}, first, last)).rejects.toThrow()
})
it('reads the requested Microsoft mailbox and preserves busy instants', async () => {
  d.fetch.mockResolvedValue(ok({value: [{scheduleId: 'LEASING@example.com', scheduleItems: [
    {status: 'busy', start: {dateTime: '2026-03-09T13:00:00.0000000', timeZone: 'UTC'}, end: {dateTime: '2026-03-09T14:00:00.0000000', timeZone: 'UTC'}},
    {status: 'free'},
  ]}]}))
  expect(await fetchBusyTimes({...config, provider: 'microsoft'}, first, last)).toEqual([{start: '2026-03-09T13:00:00.000Z', end: '2026-03-09T14:00:00.000Z'}])
  expect(d.fetch.mock.calls[0][1].headers.Prefer).toBe('outlook.timezone="UTC"')
})
it.each(['google', 'microsoft'] as const)('bounds a repeated %s 401 to one refresh', async provider => {
  vi.stubEnv('GOOGLE_CLIENT_ID','fixture');vi.stubEnv('GOOGLE_CLIENT_SECRET','fixture');vi.stubEnv('MICROSOFT_CLIENT_ID','fixture');vi.stubEnv('MICROSOFT_CLIENT_SECRET','fixture');
  d.fetch.mockResolvedValueOnce({ok: false, status: 401}).mockResolvedValueOnce(ok({access_token: 'refreshed', expires_in: 3600})).mockResolvedValueOnce({ok: false, status: 401})
  await expect(fetchBusyTimes({...config, provider}, first, last)).rejects.toThrow('401')
  expect(d.fetch).toHaveBeenCalledTimes(3)
})
it('keeps unknown config health unknown and honors an explicit zero buffer', async () => {
  d.row = {...config, token_status: null}; expect(await getCalendarConfig('property')).toMatchObject({token_status: 'unknown', buffer_minutes: 0})
})
it('uses the explicit property timezone consistently with booking context', async () => {
  d.row = {...config, properties: {settings: {timezone: 'Asia/Kolkata'}}}; expect(await getCalendarConfig('property')).toMatchObject({timezone: 'Asia/Kolkata'})
})
it('does not substitute a timezone when both property and calendar lack one', async () => {
  d.row = {...config, timezone: null}; await expect(getCalendarConfig('property')).rejects.toThrow('timezone')
})
it('keeps failed configuration reads distinct from no connection', async () => {
  d.error = new Error('Fixture outage'); await expect(getCalendarConfig('property')).rejects.toThrow('could not be read')
})
it('respects a buffer before and after existing appointments', () => {
  const slots = generateAvailableSlots('2026-03-09', {...config, buffer_minutes: 15}, [{start: '2026-03-09T13:45:00Z', end: '2026-03-09T14:15:00Z'}], before)
  expect(slots.filter(slot => !slot.available).map(slot => slot.time)).toEqual(['09:30', '10:00'])
  expect(slots.find(slot => slot.time === '10:30')?.available).toBe(true)
})
it('rejects malformed busy intervals rather than opening those slots', () => {
  expect(() => generateAvailableSlots('2026-03-09', config, [{start: '', end: ''}], before)).toThrow('busy interval')
})
it('does not offer already-started property-local slots', () => {
  const slots = generateAvailableSlots('2026-03-09', config, [], new Date('2026-03-09T13:01:00Z'))
  expect(slots[0]).toEqual({time: '09:00', available: false}); expect(slots[1].available).toBe(true)
})
it.each([['2026-03-08', '02:00', '03:30'], ['2026-11-01', '01:00', '02:30']])('holds DST gaps/folds on %s', (date, start, end) => {
  const slots = generateAvailableSlots(date, {...config, working_hours: {sun: {start, end, enabled: true}}}, [], before)
  expect(slots.slice(0, 2).every(slot => !slot.available)).toBe(true); expect(slots.at(-1)?.available).toBe(true)
})
it.each([0, -30, 9999])('rejects invalid duration %s before a slot loop', duration => {
  expect(() => generateAvailableSlots('2026-03-09', {...config, tour_duration_minutes: duration}, [], before)).toThrow('duration')
})
it('uses property dates near midnight and UTC date arithmetic across months', () => {
  expect(calendarToday('Pacific/Honolulu', new Date('2026-03-01T03:00:00Z'))).toBe('2026-02-28')
  expect(addCalendarDays('2026-02-28', 1)).toBe('2026-03-01')
  expect(() => addCalendarDays('2026-02-30', 1)).toThrow()
})
it.each([['2026-03-08', 23], ['2026-11-01', 25]])('queries the complete %s property day', (date, hours) => {
  const range = calendarDayRange(String(date), String(date), 'America/New_York'); expect((+range.end - +range.start) / 3600000).toBe(hours)
})
it('pins both downloaded and response calendar attachments to the same tour instant', () => {
  const result = generateTourCalendarResponse({propertyName: 'Fixture', tourDate: '2026-03-09', tourTime: '09:00', tourType: 'in_person', durationMinutes: 45, prospectName: 'Fixture', prospectEmail: 'fixture@example.com', startsAt: '2026-03-09T13:00:00Z', uid: 'fixture-tour@p11'})
  expect(result.icsContent).toContain('DTSTART:20260309T130000Z'); expect(result.icsContent).toContain('DTEND:20260309T134500Z'); expect(result.icsContent).toContain('UID:fixture-tour@p11')
  expect(new URL(result.calendarLinks.google).searchParams.get('dates')).toBe('20260309T130000Z/20260309T134500Z')
})
