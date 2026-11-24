import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CampaignTable } from './CampaignTable'

const campaign = {
  campaign_id: 'one',
  campaign_name: 'Search campaign',
  channel: 'google_ads',
  impressions: 200,
  clicks: 1,
  spend: 10,
  conversions: 0,
  ctr: 0.5,
  cpc: 10,
  cpa: null,
  first_date: '2026-11-01',
  last_date: '2026-11-01',
}

describe('campaign cost per click', () => {
  it('renders per-campaign values and divides combined spend by combined clicks', () => {
    const html = renderToStaticMarkup(createElement(CampaignTable, {
      channels: ['google_ads', 'meta_ads'],
      campaigns: [
        campaign,
        { ...campaign, campaign_id: 'two', channel: 'meta_ads', clicks: 9, spend: 9, cpc: 1 },
      ],
    }))
    expect(html).toContain('aria-label="Cost per click"')
    expect(html).toContain('>$10.00</td>')
    expect(html).toContain('>$1.00</td>')
    expect(html).toContain('>$1.90</strong> avg CPC')
  })

  it('leaves the average unavailable when currency is unknown or clicks are zero', () => {
    for (const values of [{ spend: null, cpc: null }, { clicks: 0, cpc: null }]) {
      const html = renderToStaticMarkup(createElement(CampaignTable, {
        channels: ['google_ads'],
        campaigns: [{ ...campaign, ...values }],
      }))
      expect(html).toContain('>Not available</strong> avg CPC')
    }
  })
})
