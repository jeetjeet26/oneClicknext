import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { readMarketingFacts } from './read-marketing-facts'
import { reconcileMarketingFacts } from './marketing-reconciliation'
import type { MarketingFact } from './read-marketing-facts'
const fact = (changes = {}): MarketingFact => ({ id: 'row', date: '2026-09-10', channel_id: 'google_ads', source_account_id: '1234567890', currency_code: 'USD', campaign_id: '100', campaign_name: 'Campaign', impressions: 100, clicks: 10, spend: 10, conversions: 0.125, raw_source: 'mcp_daily_v1', ...changes })
function client(data: unknown, error: unknown = null) { return { rpc: vi.fn().mockResolvedValue({ data, error }) } as unknown as SupabaseClient<Database> }

describe('complete marketing reports', () => {
  it('retains every record beyond the usual REST cap', async () => {
    const rows = Array.from({ length: 1205 }, (_, i) => fact({ id: String(i) }))
    const db = client({ rows, row_count: 1205, complete: true })
    const result = await readMarketingFacts(db, { propertyId: 'property', channels: ['google_ads'], sourceAccountId: '' })
    expect(result).toHaveLength(1205)
    expect(result.reduce((sum, row) => sum + (row.conversions || 0), 0)).toBe(150.625)
    expect(db.rpc).toHaveBeenCalledWith('read_marketing_facts', expect.objectContaining({ p_property_id: 'property', p_channels: ['google_ads'], p_source_account_id: '' }))
  })
  it.each([null, [], { rows: [], complete: true, row_count: 2 }, { rows: [], complete: false, row_count: 0 }])('refuses an unconfirmed report envelope', async value => {
    await expect(readMarketingFacts(client(value), { propertyId: 'property' })).rejects.toThrow('complete report')
  })
  it('keeps an actual empty report valid', async () => {
    await expect(readMarketingFacts(client({ rows: [], row_count: 0, complete: true }), { propertyId: 'property' })).resolves.toEqual([])
  })
  it('makes a report-size limit actionable instead of truncating totals', async () => {
    await expect(readMarketingFacts(client(null, { code: '22023', message: 'Choose a shorter date range.' }), { propertyId: 'property' })).rejects.toMatchObject({ status: 400, message: 'Choose a shorter date range.' })
  })
  it.each(['2026-02-30', 'invalid', '2026-1-1'])('rejects invalid date %s before querying', async date => {
    const db = client(null)
    await expect(readMarketingFacts(db, { propertyId: 'property', startDate: date })).rejects.toMatchObject({ status: 400 })
    expect(db.rpc).not.toHaveBeenCalled()
  })
})
describe('historical data review', () => {
  it('flags missing account/currency and older provider format without inventing ownership', () => {
    const result = reconcileMarketingFacts([fact({ source_account_id: null, currency_code: null, raw_source: 'mcp' })])
    expect(result.recordsNeedingReview).toBe(1)
    expect(result.issues[0]).toMatchObject({ account: null, reasons: ['account', 'currency', 'legacy'] })
  })
  it('does not label separate accounts as duplicate campaigns', () => {
    expect(reconcileMarketingFacts([fact(), fact({ id: 'second', source_account_id: '9999999999' })]).recordsNeedingReview).toBe(0)
  })
  it('finds alias overlaps and invalid metrics', () => {
    const report = reconcileMarketingFacts([fact({ channel_id: 'meta' }), fact({ id: 'two', channel_id: 'meta_ads', spend: -1 })])
    expect(report.counts).toMatchObject({ duplicate: 2, metrics: 1 })
  })
})
