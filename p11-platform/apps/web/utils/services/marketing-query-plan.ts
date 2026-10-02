import { z } from 'zod'

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'Invalid calendar date')

export const marketingQueryPlanSchema = z.object({
  groupBy: z.enum(['none', 'day', 'week', 'month', 'channel', 'campaign']),
  startDate: calendarDate,
  endDate: calendarDate,
  channel: z.string().min(1).max(80).nullable(),
  limit: z.number().int().min(1).max(100),
}).strict().refine(plan => {
  const days = (Date.parse(plan.endDate) - Date.parse(plan.startDate)) / 86_400_000
  return days >= 0 && days <= 366
}, 'Date range must be between 0 and 366 days')

export type MarketingQueryPlan = z.infer<typeof marketingQueryPlanSchema>

export function marketingQueryParameters(propertyId: string, plan: MarketingQueryPlan) {
  return {
    p_property_id: propertyId,
    p_start_date: plan.startDate,
    p_end_date: plan.endDate,
    p_group_by: plan.groupBy,
    p_channel: plan.channel,
    p_limit: plan.limit,
  }
}
