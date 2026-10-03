import type { BiReport } from './report-data';
export const changeThresholds = { spend: 50, impressions: 40, clicks: 40, conversions: 60 } as const;
export type MarketingChange = {
    key: string;
    metric: keyof typeof changeThresholds;
    kind: 'daily' | 'period';
    date: string | null;
    value: number;
    baseline: number;
    percent: number;
    threshold: number;
};
export function detectBiChanges(report: BiReport, sourceHash: string) {
    const observed = report.coverage.observedDays, requested = report.coverage.requestedDays, priorDays = new Set(report.source.previousRows.map(r => r.date)).size;
    const dailyEligible = observed === requested && observed >= 7, periodEligible = observed === requested && priorDays === requested && !!report.comparison;
    const alerts: MarketingChange[] = [];
    function compare(metric: MarketingChange['metric'], kind: MarketingChange['kind'], date: string | null, value: number | null, baseline: number | null) {
        if (value === null || baseline === null || !Number.isFinite(value) || !Number.isFinite(baseline) || baseline <= 0)
            return;
        const percent = (value - baseline) / baseline * 100, threshold = changeThresholds[metric];
        if (!Number.isFinite(percent) || Math.abs(percent) + 1e-9 < threshold)
            return;
        alerts.push({ key: kind + ':' + metric + (date ? ':' + date : ''), metric, kind, date, value, baseline, percent, threshold });
    }
    for (const metric of Object.keys(changeThresholds) as MarketingChange['metric'][]) {
        const total = report.totals[metric];
        if (dailyEligible && total !== null)
            for (const day of report.timeSeries) {
                const value = day[metric];
                if (value !== null)
                    compare(metric, 'daily', day.date, value, (total - value) / (observed - 1));
            }
        if (periodEligible && report.comparison)
            compare(metric, 'period', null, total, report.comparison.totals[metric]);
    }
    alerts.sort((a, b) => a.key.localeCompare(b.key));
    return { definitionVersion: 'bi-alert-v1' as const, sourceHash, definitions: { thresholds: changeThresholds, minimumDailyDates: 7, dailyBaseline: 'Mean of the other dates in this report', periodBaseline: 'Immediately preceding period of the same length' }, coverage: { dailyEligible, periodEligible, currentDays: observed, requestedDays: requested, priorDays, currencyKnown: report.coverage.currencyKnown }, alerts };
}
export type MarketingChanges = ReturnType<typeof detectBiChanges>;
