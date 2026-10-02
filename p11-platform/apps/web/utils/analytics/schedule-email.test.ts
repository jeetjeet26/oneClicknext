import { describe, it, expect } from 'vitest';
import { scheduledReportEmail } from './schedule-email';
import type { BiSource } from './report-data';
import type { ScheduleConfig } from './schedule-contracts';
const config: ScheduleConfig = { name: '<Weekly & review>', frequency: 'daily', weekday: null, monthday: null, hour: 9, window: 'last_7_days', comparison: true, campaigns: true, recipients: ['fixture@example.test'] };
const fact = { id: 'one', date: '2026-09-22', channel_id: 'google_ads', source_account_id: '1111111111', currency_code: 'USD', campaign_id: 'campaign', campaign_name: '<script>private & label</script>', impressions: 100, clicks: 10, spend: 1.01, conversions: 0.125 };
const source: BiSource = { version: 'bi-v1', propertyId: 'property', propertyName: '<Property>', filters: { startDate: '2026-09-16', endDate: '2026-09-22', compare: true, channel: null, account: null }, currentRows: [fact], previousRows: [{ ...fact, id: 'prior', date: '2026-09-15', spend: 0, clicks: 0, impressions: 0, conversions: 0 }], previousPeriod: { start: '2026-09-09', end: '2026-09-15' } };
const email = (s = source, c = config) => scheduledReportEmail({ id: 'retained-run', source: s, sourceHash: 'a'.repeat(64), config: c, createdAt: '2026-09-23T09:00:00Z' }, 'reports@example.test');
describe('retained scheduled email', () => {
    it('uses retained fractional metrics and truthful coverage with undefined comparisons', () => { const v = email(); expect(v.html).toContain('0.125'); expect(v.html).toContain('$1.01'); expect(v.html).toContain('1 of 7 selected dates'); expect(v.html).toContain('Not available'); expect(v.html).not.toContain('100.00%'); expect(v.html).toContain('retained-run'); expect(v.html).toContain('a'.repeat(64)); });
    it('escapes every user and source label', () => { const h = email().html; expect(h).not.toContain('<script>'); expect(h).toContain('&lt;script&gt;private &amp; label&lt;/script&gt;'); expect(h).toContain('&lt;Property&gt;'); expect(h).toContain('&lt;Weekly &amp; review&gt;'); });
    it('includes every campaign without legacy fifteen-row truncation', () => { const rows = Array.from({ length: 31 }, (_, i) => ({ ...fact, id: String(i), campaign_id: 'campaign-' + i, campaign_name: 'Campaign ' + i })); const h = email({ ...source, currentRows: rows }).html; expect(h).toContain('Campaign 30 / campaign-30'); expect(h).toContain('$31.31'); });
    it('respects disabled campaign and comparison sections', () => { const h = email({ ...source, filters: { ...source.filters, compare: false }, previousRows: [], previousPeriod: null }, { ...config, campaigns: false, comparison: false }).html; expect(h).not.toContain('<h2>Campaigns'); expect(h).not.toContain('Change from prior period'); });
    it('rejects invalid facts instead of emailing invented zeroes', () => expect(() => email({ ...source, currentRows: [{ ...fact, clicks: NaN }] })).toThrow());
    it('rejects oversized complete email instead of silently trimming campaigns', () => expect(() => email({ ...source, currentRows: [{ ...fact, campaign_name: 'a'.repeat(530000) }] })).toThrow(/exceeds/));
});
