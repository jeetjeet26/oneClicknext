import { buildBiReport, type BiSource } from './report-data';
import { queryPlan, planFits, type QueryPlan } from './query-contracts';
import { normalizeMarketingChannelId, getMarketingChannelLabel } from './channel-identity';
import { campaignIdentity } from './marketing-fact';
export function calculateQuery(source: BiSource, plan: QueryPlan, sourceHash: string, planHash: string) {
    if (!queryPlan.safeParse(plan).success || !planFits(plan, source.filters))
        throw new Error('Review a query plan within its saved report dates and filters.');
    const filters = { ...source.filters, startDate: plan.startDate, endDate: plan.endDate, channel: plan.channel || source.filters.channel, compare: false };
    const matched = source.currentRows.filter(r => r.date >= plan.startDate && r.date <= plan.endDate && (!filters.channel || normalizeMarketingChannelId(r.channel_id) === filters.channel));
    const selected = { ...source, filters, currentRows: matched, previousRows: [], previousPeriod: null };
    const report = buildBiReport(selected), grouped = new Map<string, typeof matched>();
    for (const r of matched) {
        let key = 'all';
        switch (plan.groupBy) {
            case 'day':
                key = r.date;
                break;
            case 'week': {
                const d = new Date(r.date + 'T00:00:00Z');
                d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
                key = d.toISOString().slice(0, 10);
                break;
            }
            case 'month':
                key = r.date.slice(0, 7);
                break;
            case 'channel':
                key = normalizeMarketingChannelId(r.channel_id);
                break;
            case 'campaign':
                key = campaignIdentity(r.channel_id, r.source_account_id, r.campaign_id);
                break;
        }
        const values = grouped.get(key);
        if (values)
            values.push(r);
        else
            grouped.set(key, [r]);
    }
    const rows = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rs]) => { const last = [...rs].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).at(-1)!; const campaign = plan.groupBy === 'campaign'; return { key, label: plan.groupBy === 'none' ? 'Selected period' : plan.groupBy === 'channel' ? getMarketingChannelLabel(key) : plan.groupBy === 'week' ? 'Week starting ' + key : campaign ? (last.campaign_name || last.campaign_id) : key, channel: campaign ? normalizeMarketingChannelId(last.channel_id) : null, account: campaign ? last.source_account_id : null, campaignId: campaign ? last.campaign_id : null, ...buildBiReport({ ...selected, currentRows: rs }).totals }; });
    const result = { definitionVersion: 'bi-query-v1' as const, sourceHash, planHash, plan, filters, coverage: report.coverage, totals: report.totals, rows };
    if (new TextEncoder().encode(JSON.stringify(result)).length > 8 * 1024 * 1024)
        throw new Error('This result exceeds the retained query limit. Choose a narrower plan; no rows have been discarded.');
    return result;
}
export type QueryResult = ReturnType<typeof calculateQuery>;
