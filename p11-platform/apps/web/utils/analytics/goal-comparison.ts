export function goalReportValue(value: number | null | undefined, period: string, range: {
    start: string;
    end: string;
} | undefined, filtered: boolean, coverageComplete: boolean): number | null {
    if (value == null || !Number.isFinite(value) || filtered || !coverageComplete || !range)
        return null;
    const end = new Date(range.end + 'T00:00:00Z');
    if (!Number.isFinite(end.getTime()) || end.toISOString().slice(0, 10) !== range.end)
        return null;
    const year = end.getUTCFullYear(), month = end.getUTCMonth();
    let first: Date, last: Date;
    if (period === 'daily') {
        first = end;
        last = end;
    }
    else if (period === 'weekly') {
        const monday = end.getUTCDate() - ((end.getUTCDay() + 6) % 7);
        first = new Date(Date.UTC(year, month, monday));
        last = new Date(Date.UTC(year, month, monday + 6));
    }
    else {
        const startMonth = period === 'monthly' ? month : period === 'quarterly' ? Math.floor(month / 3) * 3 : period === 'yearly' ? 0 : -1;
        if (startMonth < 0)
            return null;
        const months = period === 'monthly' ? 1 : period === 'quarterly' ? 3 : 12;
        first = new Date(Date.UTC(year, startMonth, 1));
        last = new Date(Date.UTC(year, startMonth + months, 0));
    }
    return range.start === first.toISOString().slice(0, 10) && range.end === last.toISOString().slice(0, 10) ? value : null;
}
export function goalProgress(value: number | null, target: number, inverse: boolean, threshold: number) {
    if (value == null || !Number.isFinite(value) || !Number.isFinite(target) || target <= 0 || value < 0 || !Number.isFinite(threshold) || threshold < 1 || threshold > 100)
        return null;
    const achieved = inverse ? value <= target : value >= target;
    const percent = inverse ? (value === 0 ? 100 : target / value * 100) : value / target * 100;
    return { achieved, percent, warning: !achieved && percent < threshold };
}
