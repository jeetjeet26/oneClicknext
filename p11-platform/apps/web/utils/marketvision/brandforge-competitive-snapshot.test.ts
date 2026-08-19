import { describe, expect, it } from 'vitest'
import { buildCompetitivePositioningSnapshot } from './brandforge-competitive-snapshot'

const propertyId = '10000000-0000-4000-8000-000000000001'
const first = {
  competitorId: '20000000-0000-4000-8000-000000000001',
  competitorName: 'First Community',
  sourceUrl: 'https://first.example',
  intelligenceId: '30000000-0000-4000-8000-000000000001',
  captureId: '40000000-0000-4000-8000-000000000001',
  positioning: 'Effortless urban access',
  brandVoice: 'energetic',
  targetAudience: 'Urban professionals',
  messagingThemes: ['Access', 'Energy'],
  observedAt: '2026-08-15T12:00:00.000Z',
}
const second = {
  competitorId: '20000000-0000-4000-8000-000000000002',
  competitorName: 'Second Community',
  sourceUrl: 'https://second.example',
  intelligenceId: '30000000-0000-4000-8000-000000000002',
  captureId: null,
  positioning: 'Quiet design-led homes',
  brandVoice: 'calm',
  targetAudience: 'Design-conscious households',
  messagingThemes: ['Design', 'Retreat'],
  observedAt: '2026-08-14T12:00:00.000Z',
}

describe('MarketVision BrandForge competitive snapshot hashes', () => {
  it('keeps source and causal hashes stable across capture time and row order', () => {
    const left = buildCompetitivePositioningSnapshot({
      propertyId,
      vertical: 'multifamily_rental',
      generatedAt: '2026-08-17T12:00:00.000Z',
      rows: [first, second],
    })
    const right = buildCompetitivePositioningSnapshot({
      propertyId,
      vertical: 'multifamily_rental',
      generatedAt: '2026-08-18T12:00:00.000Z',
      rows: [second, first],
    })

    expect(left.sourceHash).toBe(right.sourceHash)
    expect(left.causalHash).toBe(right.causalHash)
    expect(left.evidence.map(item => item.competitorId)).toEqual([
      first.competitorId,
      second.competitorId,
    ])
  })

  it('changes causal hashes when evidence or vertical changes', () => {
    const base = buildCompetitivePositioningSnapshot({
      propertyId,
      vertical: 'multifamily_rental',
      generatedAt: '2026-08-17T12:00:00.000Z',
      rows: [first],
    })
    const evidenceChanged = buildCompetitivePositioningSnapshot({
      propertyId,
      vertical: 'multifamily_rental',
      generatedAt: '2026-08-17T12:00:00.000Z',
      rows: [{ ...first, positioning: 'A materially different position' }],
    })
    const verticalChanged = buildCompetitivePositioningSnapshot({
      propertyId,
      vertical: 'for_sale_community',
      generatedAt: '2026-08-17T12:00:00.000Z',
      rows: [first],
    })

    expect(evidenceChanged.sourceHash).not.toBe(base.sourceHash)
    expect(evidenceChanged.causalHash).not.toBe(base.causalHash)
    expect(verticalChanged.sourceHash).toBe(base.sourceHash)
    expect(verticalChanged.causalHash).not.toBe(base.causalHash)
  })
})
