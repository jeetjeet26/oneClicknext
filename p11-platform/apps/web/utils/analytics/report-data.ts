import { campaignIdentity, formatConversions } from './marketing-fact';
import { normalizeMarketingChannelId, getMarketingChannelLabel } from './channel-identity';
import type { BiFilters } from './report-contracts';
import type { ExportData } from '@/utils/export';
export type BiFact = {
    id: string;
    date: string;
    channel_id: string | null;
    source_account_id: string | null;
    currency_code: string | null;
    campaign_id: string;
    campaign_name: string | null;
    impressions: number;
    clicks: number;
    spend: number;
    conversions: number;
};
export type BiSource = {
    version: 'bi-v1';
    propertyId: string;
    propertyName: string;
    filters: BiFilters;
    currentRows: BiFact[];
    previousRows: BiFact[];
    previousPeriod: {
        start: string;
        end: string;
    } | null;
};
export type BiTotals = {
    impressions: number;
    clicks: number;
    spend: number | null;
    conversions: number;
    ctr: number | null;
    cpc: number | null;
    cpa: number | null;
};
export function metricCurrency(value: number | null) { return value === null ? 'Not available' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value); }
export function metricPercent(value: number | null) { return value === null ? 'Not available' : value.toFixed(2) + '%'; }
function measured(v: unknown, integer = false) { if (v === null || v === undefined || v === '' || typeof v !== 'number' && typeof v !== 'string')
    throw new Error('Stored marketing values need review before this report can be used.'); const n = Number(v); if (!Number.isFinite(n) || n < 0 || n >= Number.MAX_SAFE_INTEGER || integer && !Number.isSafeInteger(n))
    throw new Error('Stored marketing values exceed report limits or need review.'); return n; }
function totals(rows: BiFact[]): BiTotals {
    let impressions = 0, clicks = 0, cents = 0, conversions = 0, moneyKnown = true;
    for (const r of rows) {
        impressions += measured(r.impressions, true);
        clicks += measured(r.clicks, true);
        cents += Math.round(measured(r.spend) * 100);
        conversions += measured(r.conversions);
        if (r.currency_code !== 'USD' && !(normalizeMarketingChannelId(r.channel_id) === 'ga4' && Number(r.spend) === 0))
            moneyKnown = false;
    }
    if (!Number.isSafeInteger(impressions) || !Number.isSafeInteger(clicks) || !Number.isSafeInteger(cents) || conversions >= Number.MAX_SAFE_INTEGER)
        throw new Error('Choose a smaller reporting range to retain numeric accuracy.');
    const spend = moneyKnown ? cents / 100 : null;
    return { impressions, clicks, spend, conversions: Number(conversions.toPrecision(15)), ctr: impressions > 0 ? clicks / impressions * 100 : null, cpc: clicks > 0 && spend !== null ? spend / clicks : null, cpa: conversions > 0 && spend !== null ? spend / conversions : null };
}
export function reportChange(current: number | null, previous: number | null) { return current === null || previous === null || previous === 0 ? null : (current - previous) / previous * 100; }
function groups(rows: BiFact[], key: (r: BiFact) => string) { const m = new Map<string, BiFact[]>(); for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list)
        list.push(r);
    else
        m.set(k, [r]);
} return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)); }
function aggregate(rows: BiFact[]) {
    const channels = groups(rows, r => normalizeMarketingChannelId(r.channel_id)).map(([channel, rs]) => ({ channel, ...totals(rs) }));
    const timeSeries = groups(rows, r => r.date).map(([date, rs]) => ({ date, ...totals(rs) }));
    const campaigns = groups(rows, r => campaignIdentity(r.channel_id, r.source_account_id, r.campaign_id)).map(([campaign_key, rs]) => { const sorted = [...rs].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)), first = sorted[0], last = sorted.at(-1)!; return { campaign_key, campaign_id: first.campaign_id, source_account_id: first.source_account_id, campaign_name: last.campaign_name || last.campaign_id, channel: normalizeMarketingChannelId(first.channel_id), first_date: first.date, last_date: last.date, ...totals(rs) }; }).sort((a, b) => (b.spend ?? -1) - (a.spend ?? -1) || a.campaign_key.localeCompare(b.campaign_key));
    return { totals: totals(rows), channels, timeSeries, campaigns };
}
export function buildBiReport(source: BiSource) {
    if (source.version !== 'bi-v1' || !Array.isArray(source.currentRows) || !Array.isArray(source.previousRows))
        throw new Error('This report definition is not supported.');
    const current = aggregate(source.currentRows), previous = aggregate(source.previousRows), changes = Object.fromEntries(Object.keys(current.totals).map(key => [key, source.currentRows.length && source.previousRows.length ? reportChange(current.totals[key as keyof BiTotals], previous.totals[key as keyof BiTotals]) : null])) as Record<keyof BiTotals, number | null>;
    const sources = groups(source.currentRows, r => JSON.stringify([normalizeMarketingChannelId(r.channel_id), r.source_account_id])).map(([, rows]) => { const dates = rows.map(r => r.date).sort(); return { channel: normalizeMarketingChannelId(rows[0].channel_id), account: rows[0].source_account_id, records: rows.length, days: new Set(dates).size, firstDate: dates[0], lastDate: dates.at(-1)!, currencyKnown: totals(rows).spend !== null }; });
    const observedDays = new Set(source.currentRows.map(r => r.date)).size, requestedDays = Math.round((Date.parse(source.filters.endDate) - Date.parse(source.filters.startDate)) / 86400000) + 1;
    return { ...current, dateRange: { start: source.filters.startDate, end: source.filters.endDate }, comparison: source.filters.compare ? { previousPeriod: source.previousPeriod, totals: previous.totals, changes, channelChanges: current.channels.map(c => { const p = previous.channels.find(x => x.channel === c.channel); return { channel: c.channel, ...Object.fromEntries(['spend', 'clicks', 'impressions', 'conversions'].map(k => [k, p ? reportChange(c[k as keyof BiTotals], p[k as keyof BiTotals]) : null])) }; }) } : null, coverage: { records: source.currentRows.length, previousRecords: source.previousRows.length, observedDays, requestedDays, sources, unknownAccountRecords: source.currentRows.filter(r => !r.source_account_id).length, currencyKnown: current.totals.spend !== null }, source, definitionVersion: source.version };
}
export type BiReport = ReturnType<typeof buildBiReport>;
export type BiCampaign = BiReport['campaigns'][number];
export function biExportData(report: BiReport, metadata: {
    id: string;
    sourceHash: string;
    savedAt: string;
    label: string;
}): ExportData {
    return { propertyName: report.source.propertyName, dateRange: report.dateRange, reportId: metadata.id, sourceHash: metadata.sourceHash, generatedAt: metadata.savedAt, notes: ['Saved report: ' + metadata.label, 'Includes every stored matching record; this is not proof of complete provider delivery.', 'Dollar values are USD where confirmed. Missing dates are not filled with invented zeroes.', 'Conversions are provider-attributed actions, may be fractional, and are not deduplicated people or verified leases.', 'CTR = clicks / impressions; CPC = spend / clicks; CPA = spend / conversions. Undefined rates and zero-baseline changes are unavailable.'], metrics: [{ label: 'Total spend', value: metricCurrency(report.totals.spend), change: report.comparison?.changes.spend }, { label: 'Impressions', value: report.totals.impressions, change: report.comparison?.changes.impressions }, { label: 'Clicks', value: report.totals.clicks, change: report.comparison?.changes.clicks }, { label: 'Reported conversions', value: formatConversions(report.totals.conversions), change: report.comparison?.changes.conversions }, { label: 'CTR', value: metricPercent(report.totals.ctr), change: report.comparison?.changes.ctr }, { label: 'Cost per reported conversion', value: metricCurrency(report.totals.cpa), change: report.comparison?.changes.cpa }], timeSeries: report.timeSeries, channels: report.channels, campaigns: report.campaigns, sourceCoverage: report.coverage.sources.map(s => ({ channel: getMarketingChannelLabel(s.channel), account: s.account || 'Unattributed historical account', records: s.records, days: s.days, firstDate: s.firstDate, lastDate: s.lastDate, currency: s.currencyKnown ? 'USD or non-spend GA4' : 'Currency needs review' })) };
}
export function trendForCampaign(source: BiSource, key: string) { return aggregate(source.currentRows.filter(r => campaignIdentity(r.channel_id, r.source_account_id, r.campaign_id) === key)).timeSeries; }
