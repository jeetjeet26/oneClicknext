import { describe, expect, it } from 'vitest'
import {
  buildComparisonQueryText,
  enrichComparisonQueryText,
} from './query-text'

describe('propertyaudit query text helpers', () => {
  it('builds contextual comparison queries from competitor names', () => {
    expect(
      buildComparisonQueryText({
        propertyName: 'Kahuina',
        competitorName: 'Waiakoa',
        cityState: 'Honolulu, HI',
        pluralDisplayNoun: 'apartments',
      })
    ).toBe('Compare Kahuina with Waiakoa for apartments in Honolulu, HI')
  })

  it('enriches bare comparison names before audit execution', () => {
    expect(
      enrichComparisonQueryText({
        queryText: 'Kaliʻu',
        queryType: 'comparison',
        propertyName: 'Kahuina',
        cityState: 'Honolulu, HI',
        pluralDisplayNoun: 'apartments',
      })
    ).toBe('Compare Kahuina with Kaliʻu for apartments in Honolulu, HI')
  })

  it('leaves already contextual comparison queries unchanged', () => {
    expect(
      enrichComparisonQueryText({
        queryText: 'Kahuina vs Ālia apartments in Honolulu',
        queryType: 'comparison',
        propertyName: 'Kahuina',
        cityState: 'Honolulu, HI',
        pluralDisplayNoun: 'apartments',
      })
    ).toBe('Kahuina vs Ālia apartments in Honolulu')
  })
})
