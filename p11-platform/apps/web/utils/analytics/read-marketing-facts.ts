import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Tables } from '@/types/supabase'

export type MarketingFact = Pick<Tables<'fact_marketing_performance'>, 'id' | 'date' | 'channel_id' | 'source_account_id' | 'currency_code' | 'campaign_id' | 'campaign_name' | 'impressions' | 'clicks' | 'spend' | 'conversions' | 'raw_source'>
export class MarketingReadError extends Error {
  constructor(message: string, readonly status = 503) { super(message) }
}
export async function readMarketingFacts(client: Pick<SupabaseClient<Database>, 'rpc'>, filters: {
  propertyId: string; startDate?: string | null; endDate?: string | null;
  channels?: string[]; campaignId?: string; sourceAccountId?: string | null;
}): Promise<MarketingFact[]> {
  for (const value of [filters.startDate, filters.endDate]) {
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new MarketingReadError('Choose valid report dates.', 400)
  }
  const { data, error } = await client.rpc('read_marketing_facts', {
    p_property_id: filters.propertyId,
    p_start_date: filters.startDate ?? undefined, p_end_date: filters.endDate ?? undefined,
    p_channels: filters.channels, p_campaign_id: filters.campaignId,
    p_source_account_id: filters.sourceAccountId ?? undefined,
  })
  if (error) throw new MarketingReadError(error.code === '22023' ? error.message : 'Complete reporting data could not be loaded. Try again.', error.code === '22023' ? 400 : 503)
  if (!data || Array.isArray(data) || typeof data !== 'object' || data.complete !== true || !Array.isArray(data.rows) || data.row_count !== data.rows.length) {
    throw new MarketingReadError('The complete report could not be confirmed. Try again.')
  }
  return data.rows as MarketingFact[]
}
