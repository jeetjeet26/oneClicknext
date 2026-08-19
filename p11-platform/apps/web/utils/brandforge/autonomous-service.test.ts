import { describe, expect, it, vi } from 'vitest'
import { buildCompetitivePositioningSnapshot } from '@/utils/marketvision/brandforge-competitive-snapshot'
import { normalizeBrandForgeContract } from './normalize'
import { convergeBrandForgeContract } from './autonomous-service'

const propertyId = '10000000-0000-4000-8000-000000000001'
const brandAssetId = '20000000-0000-4000-8000-000000000001'
const orgId = '30000000-0000-4000-8000-000000000001'
const userId = '40000000-0000-4000-8000-000000000001'

function snapshot(vertical: 'multifamily_rental' | 'for_sale_community') {
  return buildCompetitivePositioningSnapshot({
    propertyId,
    vertical,
    generatedAt: '2026-08-17T12:00:00.000Z',
    rows: [{
      competitorId: '50000000-0000-4000-8000-000000000001',
      competitorName: 'Nearby Community',
      sourceUrl: 'https://competitor.example',
      intelligenceId: '60000000-0000-4000-8000-000000000001',
      captureId: '70000000-0000-4000-8000-000000000001',
      positioning: 'Elevated everyday living',
      brandVoice: 'polished',
      targetAudience: 'Local buyers and renters',
      messagingThemes: ['Convenience', 'Design'],
      observedAt: '2026-08-16T12:00:00.000Z',
    }],
  })
}

describe('autonomous BrandForge convergence', () => {
  it('generates a complete for-sale contract with deterministic fallback', async () => {
    const unavailableModel = vi.fn().mockRejectedValue(new Error('model unavailable'))
    const result = await convergeBrandForgeContract({
      mode: 'generated',
      brandAssetId,
      propertyId,
      orgId,
      requestedBy: userId,
      vertical: 'for_sale_community',
      creativeBrief: {
        brandName: 'Juniper Row',
        vision: 'A grounded neighborhood with enduring character',
        targetAudience: 'Homebuyers seeking design and connection',
        brandVoice: 'warm and assured',
        personality: ['considered', 'neighborly'],
        visualPreferences: ['earthy'],
      },
    }, snapshot('for_sale_community'), unavailableModel)

    expect(result.generation).toBe('deterministic')
    expect(result.contract.identity.name).toBe('Juniper Row')
    expect(result.contract.introduction.content).toContain('for-sale residential community')
    expect(result.contract.positioning._meta.provenance.statement[0]).toMatchObject({
      sourceType: 'competitor_brand_intelligence',
      sourceId: '60000000-0000-4000-8000-000000000001',
    })
    expect(result.contract.implementation.examples.every(example =>
      example.type.startsWith('website_expression_')
    )).toBe(true)
  })

  it('preserves a supplied rental identity and applies evidence only to website expression', async () => {
    const supplied = normalizeBrandForgeContract({
      introduction: { content: 'Locked introduction', marketInsights: ['Locked insight'] },
      positioning: {
        statement: 'Already positioned',
        rationale: 'Approved rationale',
        voice: ['direct'],
        prohibitedVoice: ['ornate'],
      },
      audience: { primary: 'Locked audience' },
      identity: {
        name: 'The Lockwood',
        tagline: 'Keep the original',
        story: 'An established story',
        rationale: 'An established rationale',
      },
      colors: {
        roles: [{
          role: 'primary',
          name: 'Locked Blue',
          hex: '#123456',
          usage: 'Everywhere approved',
        }],
      },
      implementation: {
        examples: [{ type: 'signage', description: 'Locked signage rule' }],
        lockedRules: ['Never change the identity'],
      },
    }, {
      origin: 'imported',
      approvalStatus: 'draft',
      confidence: 1,
    })
    const before = structuredClone(supplied)
    const competitiveSnapshot = snapshot('multifamily_rental')

    const result = await convergeBrandForgeContract({
      mode: 'supplied',
      brandAssetId,
      propertyId,
      orgId,
      requestedBy: userId,
      vertical: 'multifamily_rental',
      suppliedContract: supplied,
    }, competitiveSnapshot)

    expect(result.generation).toBe('supplied')
    for (const key of [
      'introduction',
      'positioning',
      'audience',
      'personas',
      'identity',
      'logos',
      'typography',
      'colors',
      'designElements',
      'photographyYes',
      'photographyNo',
    ] as const) {
      const resultMeta = result.contract[key]._meta
      const resultContent = Object.fromEntries(
        Object.entries(result.contract[key]).filter(([field]) => field !== '_meta')
      )
      const beforeContent = Object.fromEntries(
        Object.entries(before[key]).filter(([field]) => field !== '_meta')
      )
      expect(resultContent).toEqual(beforeContent)
      expect(resultMeta.approval).toEqual({ status: 'approved' })
    }
    expect(result.contract.implementation.examples).toContainEqual(
      { type: 'signage', description: 'Locked signage rule' }
    )
    expect(result.contract.implementation.examples).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'website_expression_1' }),
    ]))
  })
})
