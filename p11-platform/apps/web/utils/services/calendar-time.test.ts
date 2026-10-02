import {expect,it} from 'vitest'
import {calendarDateTimeInstant as instant} from './calendar-time'
it.each([
 ['2026-03-21T10:00:00-05:00',undefined,'2026-03-21T15:00:00.000Z'],
 ['2026-03-21T15:00:00.0000000','UTC','2026-03-21T15:00:00.000Z'],
 ['2026-03-21T10:00:00','America/Chicago','2026-03-21T15:00:00.000Z'],
 ['2026-01-01T00:00:00','Asia/Kolkata','2025-12-31T18:30:00.000Z'],
 ['2026-04-05T01:45:00','Australia/Lord_Howe',null],
 ['2026-03-08T02:30:00','America/New_York',null],
 ['2026-11-01T01:30:00','America/New_York',null],
 ['2026-03-21T10:00:00',undefined,null],
 ['2026-03-21T10:00:00','Unknown/Zone',null],
 ['2026-02-30T10:00:00Z',undefined,null],
 ['2026-03-21T25:00:00Z',undefined,null],
 ['2026-03-21',undefined,null],
])('normalizes %s in %s without guessing',(value,zone,expected)=>expect(instant(value,zone)).toBe(expected))
