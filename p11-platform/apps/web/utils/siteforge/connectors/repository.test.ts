import { describe, expect, it, vi } from 'vitest'
import {
  recordConnectorCheckpoint,
  recordConnectorFailure,
  recordConnectorReconciliation,
} from './repository'
import { DEFAULT_CONNECTOR_HEALTH } from './contracts'
import {
  connectorConfigBindingHash,
  connectorCredentialBindingHash,
  ConnectorProbeError,
  type ConnectorProbeInput,
} from './provider-adapters'

function connectorClient(health: unknown = DEFAULT_CONNECTOR_HEALTH) {
  let update: Record<string, unknown> | null = null
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    org_id: '22222222-2222-4222-8222-222222222222',
    property_id: '33333333-3333-4333-8333-333333333333',
    website_id: '44444444-4444-4444-8444-444444444444',
    provider: 'yardi',
    capability: 'inventory',
    status: 'active',
    credential_ref: 'vault://siteforge/yardi/property',
    mapping: {},
    health: {
      ...(health as typeof DEFAULT_CONNECTOR_HEALTH),
      retry: {
        ...(health as typeof DEFAULT_CONNECTOR_HEALTH).retry,
        maxAttempts: 1,
      },
    },
    freshness_seconds: 3_600,
    source_watermark: null,
    last_success_at: null,
    last_error_at: null,
    last_error: null,
    created_by: null,
    created_at: '2026-08-10T10:00:00.000Z',
    updated_at: '2026-08-10T10:00:00.000Z',
  }
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    update: vi.fn((value: Record<string, unknown>) => {
      update = value
      return chain
    }),
    single: vi.fn(async () => ({
      data: update ? { ...row, ...update } : row,
      error: null,
    })),
  }
  return {
    client: { from: vi.fn(() => chain) },
    update: () => update,
  }
}

describe('SiteForge connector repository', () => {
  it('ignores fabricated caller evidence and activates only from the adapter probe', async () => {
    const fake = connectorClient()
    const result = await recordConnectorCheckpoint(
      {
        connectorId: '11111111-1111-4111-8111-111111111111',
        websiteId: '44444444-4444-4444-8444-444444444444',
        propertyId: '33333333-3333-4333-8333-333333333333',
        checkpoint: {
          cursor: 'fabricated',
          sourceWatermark: '2099-01-01T00:00:00.000Z',
          capturedAt: '2099-01-01T00:00:00.000Z',
          recordCount: 999,
          snapshotHash: 'f'.repeat(64),
        },
        verificationEvidence: 'caller says healthy',
      },
      fake.client as never,
      vi.fn().mockImplementation(async (probeInput: ConnectorProbeInput) => ({
        checkpoint: {
          cursor: 'provider:12',
          sourceWatermark: '2026-08-10T10:59:00.000Z',
          capturedAt: '2026-08-10T11:00:00.000Z',
          recordCount: 12,
          snapshotHash: 'a'.repeat(64),
        },
        evidence: {
          adapterVersion: 'siteforge-connector-probe-v1',
          provider: 'yardi',
          credentialBindingHash: connectorCredentialBindingHash(probeInput),
          configBindingHash: connectorConfigBindingHash(probeInput),
          observedAt: '2026-08-10T11:00:00.000Z',
          snapshotHash: 'a'.repeat(64),
          requestId: 'provider-request-1',
          classification: 'success',
        },
        reconciliation: null,
      }))
    )

    expect(fake.update()).toEqual(
      expect.objectContaining({
        status: 'active',
        source_watermark: '2026-08-10T10:59:00.000Z',
      })
    )
    expect(result.health.checkpoint).toMatchObject({
      cursor: 'provider:12',
      snapshotHash: 'a'.repeat(64),
    })
    expect(result.health.diagnostics.join(' ')).not.toContain('caller says healthy')
  })

  it('classifies provider failures and never activates the connector', async () => {
    const fake = connectorClient()

    await expect(
      recordConnectorCheckpoint(
        {
          connectorId: '11111111-1111-4111-8111-111111111111',
          websiteId: '44444444-4444-4444-8444-444444444444',
          propertyId: '33333333-3333-4333-8333-333333333333',
        },
        fake.client as never,
        vi.fn().mockRejectedValue(
          new ConnectorProbeError(
            'Connector provider is unavailable',
            'provider_unavailable',
            true
          )
        )
      )
    ).rejects.toThrow('Connector provider is unavailable')

    expect(fake.update()).toEqual(
      expect.objectContaining({
        status: 'error',
        last_error:
          'provider_unavailable: Connector provider is unavailable',
      })
    )
  })

  it('rejects forged matched reconciliation evidence from a probe', async () => {
    const fake = connectorClient()
    await expect(
      recordConnectorReconciliation(
        {
          connectorId: '11111111-1111-4111-8111-111111111111',
          websiteId: '44444444-4444-4444-8444-444444444444',
          propertyId: '33333333-3333-4333-8333-333333333333',
        },
        fake.client as never,
        vi.fn().mockResolvedValue({
          checkpoint: {
            cursor: 'forged',
            sourceWatermark: '2026-08-10T10:59:00.000Z',
            capturedAt: '2026-08-10T11:00:00.000Z',
            recordCount: 1,
            snapshotHash: 'a'.repeat(64),
          },
          evidence: {
            adapterVersion: 'siteforge-connector-probe-v1',
            provider: 'yardi',
            credentialBindingHash: 'b'.repeat(64),
            configBindingHash: 'c'.repeat(64),
            observedAt: '2026-08-10T11:00:00.000Z',
            snapshotHash: 'a'.repeat(64),
            requestId: null,
            classification: 'success',
          },
          reconciliation: {
            reconciledAt: '2026-08-10T11:00:00.000Z',
            snapshotHash: 'a'.repeat(64),
            configBindingHash: 'c'.repeat(64),
            sourceCount: 1,
            targetCount: 1,
            missingSourceIds: [],
            unexpectedTargetIds: [],
            mismatchedIds: [],
            status: 'matched',
          },
        })
      )
    ).rejects.toThrow(/not bound to the current connector configuration/)

    expect(fake.update()).toEqual(
      expect.objectContaining({
        status: 'error',
        health: expect.objectContaining({ verified: false }),
      })
    )
  })

  it('clears stale verified state when a fresh reconciliation probe fails', async () => {
    const fake = connectorClient({
      ...DEFAULT_CONNECTOR_HEALTH,
      state: 'healthy',
      verified: true,
      checkedAt: '2026-08-09T11:00:00.000Z',
      message: 'Previously verified.',
    })

    await expect(
      recordConnectorReconciliation(
        {
          connectorId: '11111111-1111-4111-8111-111111111111',
          websiteId: '44444444-4444-4444-8444-444444444444',
          propertyId: '33333333-3333-4333-8333-333333333333',
        },
        fake.client as never,
        vi.fn().mockRejectedValue(new Error('Unexpected adapter failure'))
      )
    ).rejects.toThrow('Connector provider probe failed')

    expect(fake.update()).toEqual(
      expect.objectContaining({
        health: expect.objectContaining({ verified: false }),
      })
    )
  })

  it('verifies matched reconciliation only from a fresh bound probe', async () => {
    const fake = connectorClient()
    const probe = vi.fn().mockImplementation(async (probeInput: ConnectorProbeInput) => {
      const credentialBindingHash =
        connectorCredentialBindingHash(probeInput)
      const configBindingHash = connectorConfigBindingHash(probeInput)
      return {
        checkpoint: {
          cursor: 'reconcile:12',
          sourceWatermark: '2026-08-10T10:59:00.000Z',
          capturedAt: '2026-08-10T11:00:00.000Z',
          recordCount: 12,
          snapshotHash: 'a'.repeat(64),
        },
        evidence: {
          adapterVersion: 'siteforge-connector-probe-v1' as const,
          provider: 'yardi',
          credentialBindingHash,
          configBindingHash,
          observedAt: '2026-08-10T11:00:00.000Z',
          snapshotHash: 'a'.repeat(64),
          requestId: 'provider-request-2',
          classification: 'success' as const,
        },
        reconciliation: {
          reconciledAt: '2026-08-10T11:00:00.000Z',
          snapshotHash: 'a'.repeat(64),
          configBindingHash,
          sourceCount: 12,
          targetCount: 12,
          missingSourceIds: [],
          unexpectedTargetIds: [],
          mismatchedIds: [],
          status: 'matched' as const,
        },
      }
    })

    const result = await recordConnectorReconciliation(
      {
        connectorId: '11111111-1111-4111-8111-111111111111',
        websiteId: '44444444-4444-4444-8444-444444444444',
        propertyId: '33333333-3333-4333-8333-333333333333',
      },
      fake.client as never,
      probe
    )

    expect(result.health).toMatchObject({
      state: 'healthy',
      verified: true,
      reconciliation: { status: 'matched' },
    })
    expect(fake.update()).toEqual(
      expect.objectContaining({ status: 'active' })
    )
  })

  it('dead-letters terminal failures with deterministic operator diagnostics', async () => {
    const fake = connectorClient()
    const result = await recordConnectorFailure(
      {
        connectorId: '11111111-1111-4111-8111-111111111111',
        websiteId: '44444444-4444-4444-8444-444444444444',
        propertyId: '33333333-3333-4333-8333-333333333333',
        failedAt: '2026-08-10T11:00:00.000Z',
        errorCode: 'provider_rejected',
        message: 'Provider rejected the checkpoint.',
        retryable: false,
        checkpointCursor: 'page:4',
      },
      fake.client as never
    )

    expect(fake.update()).toEqual(
      expect.objectContaining({
        status: 'error',
        last_error: 'provider_rejected: Provider rejected the checkpoint.',
      })
    )
    expect(result.health.deadLetters).toEqual([
      expect.objectContaining({
        checkpointCursor: 'page:4',
        attempts: 1,
        errorCode: 'provider_rejected',
      }),
    ])
    expect(result.health.diagnostics).toContain(
      'Failure requires operator reconciliation.'
    )
  })
})
