import { describe, expect, it } from 'vitest'
import { parseMarketingCSV } from './marketing-csv-parser'

describe('marketing CSV conversions', () => {
  it.each(['google_ads', 'meta_ads'] as const)('preserves fractional daily conversions for %s', platform => {
    const result = parseMarketingCSV('Date,Clicks,Impressions,Cost,Conversions\n2026-09-10,10,100,12.50,"1,234.000125"', 'daily.csv', 'Campaign', platform)
    expect(result.success).toBe(true)
    expect(result.rows[0]).toMatchObject({ conversions: 1234.000125, clicks: 10, impressions: 100, channel_id: platform })
  })

  it('preserves fractions when parsing a campaign summary', () => {
    const result = parseMarketingCSV('Campaign,Clicks,Impressions,Cost,Conversions\nCampaign,10,100,12.50,0.000125', 'summary.csv', 'Campaign', 'google_ads')
    expect(result.reportType).toBe('campaign_summary')
    expect(result.rows[0].conversions).toBe(0.000125)
  })

  it.each(['nope', '3 conversions', 'NaN', 'Infinity', '0x10'])('does not turn invalid conversion text %s into zero', value => {
    const result = parseMarketingCSV(`Date,Clicks,Conversions\n2026-09-10,10,${value}`, 'daily.csv', 'Campaign', 'google_ads')
    expect(result.rows[0].conversions).toBeNaN()
  })
})
