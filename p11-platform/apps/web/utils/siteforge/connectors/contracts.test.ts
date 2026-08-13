import { describe, expect, it } from 'vitest'
import {
  connectorCommandSchema,
  createConnectorConfigSchema,
  evaluateConnectorFreshness,
  normalizeConnectorHealth,
} from './contracts'

describe('SiteForge connector contracts', () => {
  it('stores credential references and rejects embedded provider credentials', () => {
    const config = {
      propertyId: '11111111-1111-4111-8111-111111111111',
      provider: 'lasso',
      capability: 'conversion',
      credentialRef:
        'integration://22222222-2222-4222-8222-222222222222',
      mapping: {
        version: 1,
        fields: [
          {
            source: 'email',
            target: 'emails[0].email',
            required: true,
            transform: 'lowercase',
          },
        ],
        validatedAt: null,
        validationEvidence: [],
      },
      freshnessSeconds: 3_600,
    }
    expect(createConnectorConfigSchema.safeParse(config).success).toBe(true)
    expect(
      createConnectorConfigSchema.safeParse({
        ...config,
        credentials: { apiKey: 'invented-secret' },
      }).success
    ).toBe(false)
    expect(
      createConnectorConfigSchema.safeParse({
        ...config,
        credentialRef: 'invented-secret',
      }).success
    ).toBe(false)
  })

  it('starts with unknown unverified health instead of provider success', () => {
    expect(normalizeConnectorHealth(null)).toEqual(
      expect.objectContaining({
        state: 'unknown',
        verified: false,
        checkpoint: null,
        diagnostics: ['No provider request has been made.'],
      })
    )
  })

  it('rejects caller-supplied reconciliation evidence', () => {
    expect(
      connectorCommandSchema.safeParse({
        action: 'reconcile',
        propertyId: '11111111-1111-4111-8111-111111111111',
        reconciliation: {
          reconciledAt: '2026-08-10T12:00:00.000Z',
          snapshotHash: 'a'.repeat(64),
          configBindingHash: 'b'.repeat(64),
          sourceCount: 1,
          targetCount: 1,
          missingSourceIds: [],
          unexpectedTargetIds: [],
          mismatchedIds: [],
          status: 'matched',
        },
      }).success
    ).toBe(false)
  })

  it('evaluates durable watermark freshness deterministically', () => {
    expect(
      evaluateConnectorFreshness({
        sourceWatermark: '2026-08-10T10:00:00.000Z',
        freshnessSeconds: 3_600,
        now: new Date('2026-08-10T10:30:00.000Z'),
      })
    ).toMatchObject({ state: 'fresh', stale: false, ageSeconds: 1_800 })
    expect(
      evaluateConnectorFreshness({
        sourceWatermark: '2026-08-10T10:00:00.000Z',
        freshnessSeconds: 3_600,
        now: new Date('2026-08-10T12:00:00.000Z'),
      })
    ).toMatchObject({ state: 'stale', stale: true, ageSeconds: 7_200 })
  })
})
