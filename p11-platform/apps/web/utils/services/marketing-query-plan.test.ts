import { describe, expect, it } from 'vitest'
import { marketingQueryParameters, marketingQueryPlanSchema } from './marketing-query-plan'

const valid = {
  groupBy: 'channel', startDate: '2026-09-01', endDate: '2026-09-05',
  channel: null, limit: 100,
}

describe('marketing query plan boundary', () => {
  it.each([
    { sql: 'select * from profiles' },
    { propertyId: 'different-property' },
    { groupBy: 'pg_sleep(10)' },
    { startDate: '2026-02-30' },
    { startDate: '2026-9-01' },
    { startDate: '2026-09-06' },
    { startDate: '2020-01-01' },
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { channel: 'a'.repeat(81) },
  ])('rejects invalid or unauthorized plan fields: %j', fields => {
    expect(marketingQueryPlanSchema.safeParse({ ...valid, ...fields }).success).toBe(false)
  })

  it('binds property identity separately and treats channel text literally', () => {
    const plan = marketingQueryPlanSchema.parse({ ...valid, channel: "x' OR true --" })
    expect(marketingQueryParameters('authorized-property', plan)).toEqual({
      p_property_id: 'authorized-property', p_start_date: valid.startDate,
      p_end_date: valid.endDate, p_group_by: 'channel', p_channel: "x' OR true --", p_limit: 100,
    })
  })
})
