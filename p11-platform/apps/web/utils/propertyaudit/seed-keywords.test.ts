import { describe, expect, it } from 'vitest'
import { normalizeSeedKeywords, parseSeedKeywordCsv } from './seed-keywords'

describe('PropertyAudit seed keyword parser', () => {
  it('parses preamble-heavy keyword reports and ranks high-intent rows', () => {
    const result = parseSeedKeywordCsv(`Search keyword report
December 1, 2025 - May 21, 2026

Keyword status\tKeyword\tMatch type\tCampaign\tAd group\tStatus\tStatus reasons\tFinal URL\tImpr.\tInteractions\tInteraction rate\tCurrency code\tAvg. cost\tCost\tConv. rate\tConversions\tCost / conv.
Enabled\tthree bedroom condo for sale in Glendora\tBroad match\tUnit Type\t3 Bedroom\tNot eligible\trarely served\t\t0\t0\t --\tUSD\t0\t0.00\t0.00%\t0.00\t0.00
Enabled\t2 bedroom Townhomes near me\tBroad match\tUnit Type\t2 Bedroom\tEligible\t\t\t5,236\t632\t12.07%\tUSD\t2.05\t1296.92\t3.85%\t24.33\t53.30
Enabled\t2 bedroom Townhomes near me\tBroad match\tUnit Type\t2 Bedroom\tEligible\t\t\t1\t0\t0.00%\tUSD\t0\t0.00\t0.00%\t0.00\t0.00
 --\t\tTotal: Your keywords\t --\t --\t --\t\t\t58,993\t7,496\t12.71%\tUSD\t1.98\t14869.83\t5.97%\t447.17\t33.25`)

    expect(result.detectedKeywordColumn).toBe('Keyword')
    expect(result.seeds[0].keyword).toBe('2 bedroom Townhomes near me')
    expect(result.seeds[0].metrics.interactions).toBe(632)
    expect(result.seeds.some(seed => seed.keyword.startsWith('Total:'))).toBe(false)
    expect(result.duplicateRows).toBe(1)
  })

  it('normalizes object and string seeds with dedupe and score ordering', () => {
    const seeds = normalizeSeedKeywords([
      ' Glendora new construction ',
      { keyword: 'glendora new construction', conversions: 2 },
      { text: 'new townhomes for sale Glendora', impressions: '1,200', interactions: '50' },
      { keyword: 'Total: Account' },
    ])

    expect(seeds.map(seed => seed.keyword)).toEqual([
      'glendora new construction',
      'new townhomes for sale Glendora',
    ])
    expect(seeds[0].score).toBeGreaterThan(seeds[1].score)
  })
})
