import { it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ client: vi.fn(), access: vi.fn() }))
vi.mock('@/utils/supabase/server', () => ({ createClient: mocks.client }))
vi.mock('@/utils/services/auth-guard', () => ({ validatePropertyAccess: mocks.access }))
import { GET } from './route'
import { campaignIdentity, conversionValue, factAccountId, formatConversions } from '@/utils/analytics/marketing-fact'

type Row = { date: string; channel_id: string; source_account_id: string | null; campaign_id: string; campaign_name: string; impressions: number; clicks: number; spend: number; conversions: number }
let rows: Row[]
let error: { message: string } | null
let from: ReturnType<typeof vi.fn>
let user: { id: string } | null
beforeEach(() => {
  rows = ['1111111111', '2222222222'].map((account, i) => ({ date: '2026-09-10', channel_id: 'google_ads', source_account_id: account, campaign_id: '100', campaign_name: `Account ${i + 1}`, impressions: 100, clicks: 10, spend: 10, conversions: i ? 0.75 : 0.125 }))
  error = null; user = { id: 'member' }
  from = vi.fn(async (_name: string, filters: { p_campaign_id?: string; p_channels?: string[]; p_source_account_id?: string }) => {
    let selected = rows
    if (filters.p_campaign_id) selected = selected.filter(row => row.campaign_id === filters.p_campaign_id)
    if (filters.p_channels) selected = selected.filter(row => filters.p_channels!.includes(row.channel_id))
    if (filters.p_source_account_id !== undefined) selected = selected.filter(row => row.source_account_id === (filters.p_source_account_id || null))
    return { data: { rows: selected, row_count: selected.length, complete: true }, error }
  })
  mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user }, error: null }) }, rpc: from })
  mocks.access.mockResolvedValue({ authorized: true })
})
const get = (params = '') => GET(new Request(`http://localhost/api/analytics/campaigns?propertyId=fixture${params}`) as NextRequest)

it('keeps identical campaign IDs distinct across accounts and channels', async () => {
  rows.push({ ...rows[0], channel_id: 'meta_ads', conversions: 0.5 })
  const result = await (await get()).json()
  expect(result.campaigns).toHaveLength(3)
  expect(new Set(result.campaigns.map((row: { campaign_key: string }) => row.campaign_key)).size).toBe(3)
  expect(result.totals.conversions).toBe(1.375)
  expect(result.campaigns[0].source_account_id).toBe('1111111111')
})
it('filters a daily trend by account and channel and preserves fractions', async () => {
  rows.push({ ...rows[0], channel_id: 'meta_ads', conversions: 90 })
  const result = await (await get('&campaignId=100&channel=google_ads&sourceAccountId=1111111111')).json()
  expect(result.trends).toHaveLength(1)
  expect(result.trends[0].conversions).toBe(0.125)
})
it('refuses an ambiguous older campaign-only request', async () => {
  expect((await get('&campaignId=100')).status).toBe(409)
})
it('can inspect an explicitly selected historical account without mixing it', async () => {
  rows.push({ ...rows[0], source_account_id: null, conversions: 7 })
  const result = await (await get('&campaignId=100&channel=google_ads&sourceAccountId=')).json()
  expect(result.trends).toHaveLength(1); expect(result.trends[0].conversions).toBe(7)
})
it('fails property authorization before reading facts', async () => {
  mocks.access.mockResolvedValue({ authorized: false })
  expect((await get()).status).toBe(403); expect(from).not.toHaveBeenCalled()
})
it('requires sign-in before reading facts', async () => {
  user = null
  expect((await get()).status).toBe(401); expect(from).not.toHaveBeenCalled()
})
it('does not disguise database failure as an empty campaign list', async () => {
  error = { message: 'Fixture unavailable' }
  expect((await get()).status).toBe(503)
})
it('normalizes provider account forms and displays small fractions', () => {
  expect(factAccountId('google_ads', '123-456-7890')).toBe('1234567890')
  expect(factAccountId('meta_ads', 'act_12345')).toBe('12345')
  expect(formatConversions(0.000125)).toBe('0.000125')
  expect(conversionValue('0.125')).toBe(0.125)
  expect(campaignIdentity('meta', null, '100')).not.toBe(campaignIdentity('meta', '12345', '100'))
})
it.each(['NaN', 'Infinity', '-1', '2bad', '', '1000000000000000'])('rejects invalid conversion value %s', value => {
  expect(() => conversionValue(value)).toThrow()
})


it('CSV export preserves account identity and small fractional values', async () => {
  const { generateCSV } = await import('@/utils/export')
  const csv = generateCSV({ propertyName: 'Fixture', dateRange: { start: '2026-09-10', end: '2026-09-10' }, metrics: [], campaigns: [{ campaign_name: 'Same campaign', source_account_id: '1234567890', channel: 'google_ads', impressions: 100, clicks: 10, spend: 12.5, conversions: 0.000125, ctr: 10, cpc: 1.25, cpa: 25 }] })
  expect(csv).toContain('"Campaign","Account","Channel"')
  expect(csv).toContain('"1234567890"')
  expect(csv).toContain('"0.000125"')
})
