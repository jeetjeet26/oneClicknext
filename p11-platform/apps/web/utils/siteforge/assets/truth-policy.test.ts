import { describe, expect, it } from 'vitest'
import { evaluateSiteForgeAssetTruth } from './truth-policy'

const base = {
  assetId: 'asset-1',
  truthClass: 'documentary' as const,
  generated: false,
  sourceType: 'client_upload',
  contentHash: 'a'.repeat(64),
  rightsOwner: 'Property owner',
  allowedUsage: ['website'],
  expiresAt: null,
  transformations: [],
  modelMetadata: null,
  factualSubjects: ['building'],
}

describe('SiteForge asset truth policy', () => {
  it('accepts rights-bound documentary property media', () => {
    expect(evaluateSiteForgeAssetTruth(base)).toEqual([])
  })

  it('records generated documentary property representations as advisory', () => {
    const findings = evaluateSiteForgeAssetTruth({
      ...base,
      generated: true,
      sourceType: 'ai_generation',
      modelMetadata: { model: 'image-model' },
    })
    expect(findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'generated_documentary_asset',
        'generated_factual_subject',
      ])
    )
    expect(findings.every((finding) => finding.severity === 'warning')).toBe(true)
  })

  it('allows generated brand graphics without factual subjects', () => {
    expect(
      evaluateSiteForgeAssetTruth({
        ...base,
        truthClass: 'generated_brand_graphic',
        generated: true,
        sourceType: 'brandforge',
        rightsOwner: null,
        factualSubjects: [],
        allowedUsage: ['website', 'brand_graphic'],
        modelMetadata: { model: 'image-model' },
      })
    ).toEqual([])
  })
})
