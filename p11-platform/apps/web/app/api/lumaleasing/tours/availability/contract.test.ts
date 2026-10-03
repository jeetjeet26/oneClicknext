import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import type {NextRequest} from 'next/server'
const d = vi.hoisted(() => ({config: vi.fn(), busy: vi.fn()}))
vi.mock('@/utils/services/luma-public-read', () => ({admitLumaRead: vi.fn().mockResolvedValue(null)}))
vi.mock('@/utils/services/rate-limiter', () => ({publicReadLimiter: {check: () => ({allowed: true})}, getRateLimitKey: () => 'fixture', rateLimitHeaders: () => ({})}))
vi.mock('@/utils/supabase/admin', () => ({createServiceClient: () => ({from: () => {
  const q = {select: () => q, eq: () => q, single: async () => ({data: {property_id: 'property', tours_enabled: true}, error: null})}; return q
}})}))
vi.mock('@/utils/services/google-calendar', async importOriginal => ({...await importOriginal<typeof import('@/utils/services/google-calendar')>(), getCalendarConfig: d.config, fetchBusyTimes: d.busy}))
import {GET} from './route'
const hours = {start: '09:00', end: '12:00', enabled: true}
const config = {token_status: 'healthy', timezone: 'America/New_York', tour_duration_minutes: 30, buffer_minutes: 15,
  working_hours: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(day => [day, hours]))}
const call = (query = '') => GET(new Request(`http://localhost/api/lumaleasing/tours/availability?apiKey=fixture${query}`) as NextRequest)
beforeEach(() => {vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-01T03:00:00Z')); d.config.mockResolvedValue(config); d.busy.mockResolvedValue([])})
afterEach(() => vi.useRealTimers())
it('defaults to fourteen property days even when the visitor and server are on another day', async () => {
  d.config.mockResolvedValue({...config, timezone: 'Pacific/Honolulu', working_hours: Object.fromEntries(Object.keys(config.working_hours).map(day => [day, {start: '18:00', end: '20:00', enabled: true}]))})
  const response = await call(); expect(response.status).toBe(200)
  expect(d.busy.mock.calls[0].slice(1)).toEqual([new Date('2026-02-28T09:45:00Z'), new Date('2026-03-14T10:15:00Z')])
  const data = await response.json(); expect(data.availableDates[0]).toBe('2026-02-28'); expect(data.availableDates).toHaveLength(14)
})
it('reads the whole DST transition day plus its buffer', async () => {
  expect((await call('&startDate=2026-03-08&endDate=2026-03-08')).status).toBe(200)
  expect(d.busy.mock.calls[0].slice(1)).toEqual([new Date('2026-03-08T04:45:00Z'), new Date('2026-03-09T04:15:00Z')])
})
it('keeps provider uncertainty distinct from no available dates', async () => {
  d.busy.mockRejectedValue(new Error('Private provider error'))
  const response = await call('&startDate=2026-03-09&endDate=2026-03-09'); expect(response.status).toBe(503)
  expect(await response.json()).toEqual({error: 'Tour availability could not be verified', fallback: true, message: 'Tour booking is temporarily unavailable. Please try again or contact the property.'})
})
it('uses known busy instants to withhold overlapping and buffer-adjacent slots', async () => {
  d.busy.mockResolvedValue([{start: '2026-03-09T13:45:00Z', end: '2026-03-09T14:15:00Z'}])
  const response = await call('&startDate=2026-03-09&endDate=2026-03-09'); const data = await response.json()
  expect(data.slotsByDate['2026-03-09'].filter((slot: {available: boolean}) => !slot.available).map((slot: {time: string}) => slot.time)).toEqual(['09:30', '10:00'])
})
it.each(['2026-02-30', '2026-03-09T10:00:00Z'])('rejects %s as a date label before a provider read', async value => {
  expect((await call(`&startDate=${value}`)).status).toBe(400); expect(d.busy).not.toHaveBeenCalled()
})
it('bounds the range by calendar days across DST', async () => {
  expect((await call('&startDate=2026-03-01&endDate=2026-03-31')).status).toBe(200)
  expect((await call('&startDate=2026-03-01&endDate=2026-04-01')).status).toBe(400)
})
