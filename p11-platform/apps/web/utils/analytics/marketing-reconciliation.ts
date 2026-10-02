import { campaignIdentity } from './marketing-fact'
import { normalizeMarketingChannelId } from './channel-identity'
import type { MarketingFact } from './read-marketing-facts'

export const REVIEW_REASONS = {
  account: 'Confirm the source ad account',
  currency: 'Confirm the reporting currency',
  legacy: 'Compare this earlier import with the provider’s daily export',
  duplicate: 'Review overlapping campaign records',
  metrics: 'Review invalid metric values',
} as const
export function reconcileMarketingFacts(rows: MarketingFact[]) {
  const identities = new Map<string, number>()
  for (const row of rows) {
    const identity = `${row.date}:${campaignIdentity(row.channel_id, row.source_account_id, row.campaign_id)}`
    identities.set(identity, (identities.get(identity) || 0) + 1)
  }
  const counts = { account: 0, currency: 0, legacy: 0, duplicate: 0, metrics: 0 }
  const issues = rows.flatMap(row => {
    const reasons: Array<keyof typeof REVIEW_REASONS> = []
    if (!row.source_account_id) reasons.push('account')
    if (row.currency_code !== 'USD' && !(normalizeMarketingChannelId(row.channel_id) === 'ga4' && Number(row.spend) === 0 && row.currency_code === null)) reasons.push('currency')
    if (row.raw_source === 'mcp') reasons.push('legacy')
    const identity = `${row.date}:${campaignIdentity(row.channel_id, row.source_account_id, row.campaign_id)}`
    if ((identities.get(identity) || 0) > 1) reasons.push('duplicate')
    if ([row.spend, row.conversions, row.clicks, row.impressions].some(value => value === null || !Number.isFinite(Number(value)) || Number(value) < 0)) reasons.push('metrics')
    if (!reasons.length) return []
    for (const reason of reasons) counts[reason]++
    return [{ id: row.id, date: row.date, campaign: row.campaign_name || row.campaign_id, campaignId: row.campaign_id, account: row.source_account_id, channel: normalizeMarketingChannelId(row.channel_id), source: row.raw_source, reasons, spend: row.spend, conversions: row.conversions }]
  })
  return { checkedAt: new Date().toISOString(), recordsChecked: rows.length, recordsNeedingReview: issues.length, counts, issues, complete: true as const }
}
export type MarketingReconciliation = ReturnType<typeof reconcileMarketingFacts>
