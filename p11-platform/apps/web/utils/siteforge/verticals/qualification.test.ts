import { describe, expect, it } from 'vitest'
import { buildSiteForgeVerticalQualificationReport } from './qualification'

describe('SiteForge Vertical V2 qualification matrix', () => {
  it('qualifies all 26 vertical fixtures without unsupported defaults', () => {
    const report = buildSiteForgeVerticalQualificationReport()
    expect(report.fixtureCount).toBe(26)
    expect(report.exactManifestCount).toBe(26)
    expect(report.exactOfferingCount).toBe(26)
    expect(report.exactConversionCount).toBe(26)
    expect(report.thresholds).toMatchObject({
      topLevelProfileCorrectOrDeferred: 1,
      fullProfileExactness: 1,
      unsafeAskNotGuess: 1,
      unsupportedDefaultCount: 0,
    })
    expect(report.registeredBlockCount).toBe(report.schemaBackedBlockCount)
    expect(report.failures).toEqual([])
    expect(report.passed).toBe(true)
    expect(report.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })
})
