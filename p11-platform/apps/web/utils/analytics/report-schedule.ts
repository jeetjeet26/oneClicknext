export function nextReportRun(schedule: { schedule_type: string; hour_utc: number; day_of_week: number | null; day_of_month: number | null }, now = new Date()): string {
  if (!Number.isInteger(schedule.hour_utc) || schedule.hour_utc < 0 || schedule.hour_utc > 23) throw new Error('Review the report delivery hour.')
  const next = new Date(now); next.setUTCHours(schedule.hour_utc, 0, 0, 0)
  if (schedule.schedule_type === 'daily') {
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  } else if (schedule.schedule_type === 'weekly') {
    if (schedule.day_of_week === null || !Number.isInteger(schedule.day_of_week) || schedule.day_of_week < 0 || schedule.day_of_week > 6) throw new Error('Review the weekly report day.')
    next.setUTCDate(next.getUTCDate() + (schedule.day_of_week - next.getUTCDay() + 7) % 7)
    if (next <= now) next.setUTCDate(next.getUTCDate() + 7)
  } else if (schedule.schedule_type === 'monthly') {
    if (schedule.day_of_month === null || !Number.isInteger(schedule.day_of_month) || schedule.day_of_month < 1 || schedule.day_of_month > 28) throw new Error('Review the monthly report day.')
    next.setUTCDate(schedule.day_of_month)
    if (next <= now) next.setUTCMonth(next.getUTCMonth() + 1)
  } else throw new Error('Review the report frequency.')
  return next.toISOString()
}
