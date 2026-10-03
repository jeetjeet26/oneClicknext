import { describe, it, expect } from 'vitest'
import { nextReportRun } from './report-schedule'
describe('future report schedules in UTC', () => {
  const now = new Date('2026-12-28T09:00:00.000Z')
  it.each([
    ['daily', null, null, '2026-12-29T09:00:00.000Z'],
    ['weekly', 1, null, '2027-01-04T09:00:00.000Z'],
    ['monthly', null, 28, '2027-01-28T09:00:00.000Z'],
  ])('advances %s beyond the current run without backlog replay', (schedule_type, day_of_week, day_of_month, expected) => {
    expect(nextReportRun({ schedule_type, day_of_week, day_of_month, hour_utc: 9 }, now)).toBe(expected)
  })
  it('rejects an unsupported schedule before any send', () => {
    expect(() => nextReportRun({ schedule_type: 'monthly', day_of_week: null, day_of_month: 31, hour_utc: 9 }, now)).toThrow('monthly')
  })
})
