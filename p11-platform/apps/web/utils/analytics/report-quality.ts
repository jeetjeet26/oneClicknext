import type { MarketingFact } from './read-marketing-facts';
import type { BiFact } from './report-data';

/** A partial row cannot safely enter totals. Retain its existence for coverage warnings. */
export function reportingRows(rows: MarketingFact[]): BiFact[] {
  return rows.filter(r => [r.impressions, r.clicks, r.conversions, r.spend].every(v =>
    v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0,
  )).map(r => ({ ...r, impressions: Number(r.impressions), clicks: Number(r.clicks),
    conversions: Number(r.conversions), spend: Number(r.spend) }));
}
