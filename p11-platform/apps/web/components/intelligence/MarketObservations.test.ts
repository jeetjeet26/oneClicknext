import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarketObservations } from './MarketObservations'

const property = {
  score: { market: 'Sample City' },
  market: {
    competitors: [{ id: 'neighbor', name: 'Sample Apartments' }], limited: false,
    units: Array.from({ length: 25 }, (_, index) => ({
      id: `unit-${index}`, competitor_id: 'neighbor', unit_type: `Plan ${index + 1}`, bedrooms: index === 0 ? 0 : 1,
      rent_min: index === 0 ? null : 2100, rent_max: null, available_count: index === 0 ? null : 0,
      move_in_specials: null, last_updated_at: '2026-10-15T12:00:00Z',
      evidence: { source_url: index === 0 ? 'javascript:alert(1)' : 'https://example.com/pricing', effective_at: null, captured_at: '2026-10-15T12:00:00Z' },
    })),
  },
} as unknown as Parameters<typeof MarketObservations>[0]['property']

describe('market observations', () => {
  it('keeps every returned observation available without duplicating the first four', () => {
    const html = renderToStaticMarkup(React.createElement(MarketObservations, { property, client: false }))
    expect(html.match(/<article/g)).toHaveLength(25)
    expect(html).toContain('Plan 25')
    expect(html).toContain('Show 21 more observations (25 total)')
    expect(html).not.toContain('<details open')
  })
  it('distinguishes missing data from zero and retains dates and safe source links', () => {
    const html = renderToStaticMarkup(React.createElement(MarketObservations, { property, client: true }))
    expect(html).toContain('Rent unavailable')
    expect(html).toContain('Availability not recorded')
    expect(html).toContain('0 available')
    expect(html).toContain('Oct 15, 2026')
    expect(html).toContain('https://example.com/pricing')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('/dashboard/marketvision')
  })
})
