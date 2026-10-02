import { describe, expect, it } from 'vitest'
import { isWidgetSessionExpired, WIDGET_SESSION_MAX_IDLE_MS } from './widget-session'

const now = Date.parse('2026-09-15T12:00:00Z')
describe('widget session lifetime', () => {
  it.each([undefined, null, '', 'invalid'])('expires sessions without a trustworthy date: %s', date => {
    expect(isWidgetSessionExpired({ started_at: date }, now)).toBe(true)
  })
  it('uses activity, falls back to creation and expires at the 48-hour boundary', () => {
    const stale = new Date(now - WIDGET_SESSION_MAX_IDLE_MS).toISOString()
    const recent = new Date(now - 1).toISOString()
    expect(isWidgetSessionExpired({ started_at: stale }, now)).toBe(true)
    expect(isWidgetSessionExpired({ started_at: stale, last_activity_at: recent }, now)).toBe(false)
    expect(isWidgetSessionExpired({ started_at: recent }, now)).toBe(false)
  })
  it('supports the legacy session_start and created_at schemas without inventing freshness', () => {
    const recent = new Date(now - 1).toISOString()
    expect(isWidgetSessionExpired({ session_start: recent }, now)).toBe(false)
    expect(isWidgetSessionExpired({ created_at: recent }, now)).toBe(false)
    expect(isWidgetSessionExpired({ session_start: recent, last_activity_at: new Date(now - WIDGET_SESSION_MAX_IDLE_MS).toISOString() }, now)).toBe(true)
  })
  it('does not let malformed or far-future activity keep a session alive', () => {
    expect(isWidgetSessionExpired({ started_at: new Date(now).toISOString(), last_activity_at: 'bad' }, now)).toBe(true)
    expect(isWidgetSessionExpired({ last_activity_at: new Date(now + 3600000).toISOString() }, now)).toBe(true)
  })
})
