import { load } from 'cheerio'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DISCOVERY_COMPARISON_PREFIX, DISCOVERY_GROUPS } from '@/utils/marketvision/discovery-contracts'
import type { CompetitorProfile, SubjectProfile } from '@/utils/marketvision/profiles'
import { formatCompetitor } from '@/utils/marketvision/records'
import { CompetitorProfileComparison } from './CompetitorProfileComparison'

function competitor(id: string, overrides: Partial<CompetitorProfile> = {}): CompetitorProfile {
  return {
    ...formatCompetitor({ id, name: id, property_type: 'townhome' }),
    historicalBrand: null,
    reviewedBrand: null,
    scopeNotes: [],
    withheldUnitIds: [],
    ...overrides,
  }
}

function renderComparison(subject: SubjectProfile, competitors: CompetitorProfile[]) {
  const $ = load(renderToStaticMarkup(createElement(CompetitorProfileComparison, { subject, competitors })))
  const headers = $('thead th[scope="col"]').map((_, header) => $(header).text()).get()
  const rows = $('tbody tr').toArray().map(row => ({
    name: $(row).find('th[scope="row"]').text(),
    cells: $(row).find('td').toArray(),
  }))
  function cell(row: number, column: string) {
    expect(headers).toContain(column)
    return $(rows[row].cells[headers.indexOf(column) - 1])
  }
  return { headers, rows, cell }
}

describe('competitor profile comparison', () => {
  it('puts each property in a row and keeps sale evidence with the matching property', () => {
    const salePrice = { amount: 789_000, sourceUrl: 'https://builder.example/homes', quote: 'Starting at $789,000', fetchedAt: '2026-11-25T00:00:00Z' }
    const { headers, rows, cell } = renderComparison(
      { name: 'Subject', forSale: true, propertyType: 'single_family', units: [] },
      [competitor('Maple', { salePrice, notes: `${DISCOVERY_COMPARISON_PREFIX}Similar location.\n${DISCOVERY_GROUPS.related}` }), competitor('Oak')],
    )

    expect(headers.slice(0, 4)).toEqual(['Property', 'Advertised starting sale price', 'Property type', 'Bedrooms'])
    expect(headers.some(header => header.includes('rent'))).toBe(false)
    expect(rows.map(row => row.name)).toEqual(['SubjectYour property', 'Maple', 'Oak'])
    expect(rows.every(row => row.cells.length === headers.length - 1)).toBe(true)
    expect(cell(0, 'Advertised starting sale price').text()).toContain('No approved sale price')
    expect(cell(0, 'Property type').text()).toBe('Single-Family Homes')
    expect(cell(1, 'Advertised starting sale price').text()).toContain('$789,000')
    expect(cell(1, 'Advertised starting sale price').find('a').attr('href')).toBe(salePrice.sourceUrl)
    expect(cell(1, 'Competitive fit').find('summary').text()).toBe(DISCOVERY_GROUPS.related)
    expect(cell(1, 'Competitive fit').text()).toContain('Similar location.')
    expect(cell(2, 'Advertised starting sale price').text()).toContain('No advertised sale price captured')
  })

  it('uses bedroom-specific rent columns and keeps unavailable or withheld rent out of comparisons', () => {
    const unit = (id: string, bedrooms: number, rentMin: number | null) => ({
      id, bedrooms, rentMin, version: 1, competitorId: 'Hillside', unitType: id, bathrooms: null,
      sqftMin: null, sqftMax: null, rentMax: null, deposit: null, availableCount: null,
      moveInSpecials: null, lastUpdatedAt: '2026-11-25',
    })
    const { headers, rows, cell } = renderComparison(
      { name: 'Subject', units: [{ id: 'studio', bedrooms: 0, rent_min: 1500, unit_type: 'Studio', last_updated_at: null }] },
      [
        competitor('Hillside', {
          units: [unit('plan-a', 2, 2400), unit('plan-b', 2, 2600), unit('plan-c', 2, null), unit('conflict', 2, 8000)],
          withheldUnitIds: ['conflict'],
        }),
        competitor('Unconfirmed scope', { units: [unit('plan-d', 2, 9000)], scopeNotes: ['Confirm community.'] }),
      ],
    )

    expect(headers.slice(0, 3)).toEqual(['Property', 'Studio rent', '2-bed rent'])
    expect(headers).not.toContain('Advertised starting sale price')
    expect(rows.every(row => row.cells.length === headers.length - 1)).toBe(true)
    expect(cell(0, 'Studio rent').text()).toContain('$1,500')
    expect(cell(0, '2-bed rent').text()).toBe('No saved plans')
    expect(cell(1, '2-bed rent').text()).toBe('$2,5002 of 3 plans priced')
    expect(cell(2, '2-bed rent').text()).toBe('Withheld pending scope review')
  })
})
