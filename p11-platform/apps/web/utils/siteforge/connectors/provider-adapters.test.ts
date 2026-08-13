import { describe, expect, it, vi } from 'vitest'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import {
  ConnectorProbeError,
  probeConnectorProvider,
} from './provider-adapters'

const connector = {
  connectorId: '33333333-3333-4333-8333-333333333333',
  websiteId: '44444444-4444-4444-8444-444444444444',
  provider: 'yardi',
  capability: 'inventory',
  credentialRef: 'vault://siteforge/yardi/property',
  mapping: { version: 1, fields: [] },
  freshnessSeconds: 3_600,
  orgId: '11111111-1111-4111-8111-111111111111',
  propertyId: '22222222-2222-4222-8222-222222222222',
}

const config = {
  provider: 'yardi',
  credentialRef: connector.credentialRef,
  probeUrl: 'https://yardi.example.test/siteforge-probe',
  accessToken: 'server-only-secret',
}

describe('SiteForge connector provider probes', () => {
  it('computes snapshot and credential binding hashes on the server', async () => {
    const snapshot = {
      cursor: 'page:4',
      sourceWatermark: '2026-08-10T11:59:00.000Z',
      recordCount: 12,
      snapshot: { ids: ['unit-1', 'unit-2'] },
      requestId: 'provider-request-1',
    }
    const result = await probeConnectorProvider(connector, {
      config,
      fetchFn: vi.fn().mockResolvedValue(Response.json(snapshot)),
      now: () => new Date('2026-08-10T12:00:00.000Z'),
    })

    expect(result.checkpoint.snapshotHash).toBe(
      hashSiteForgeContent({
        provider: 'yardi',
        cursor: snapshot.cursor,
        sourceWatermark: snapshot.sourceWatermark,
        recordCount: snapshot.recordCount,
        snapshot: snapshot.snapshot,
        reconciliation: null,
      })
    )
    expect(result.evidence).toMatchObject({
      provider: 'yardi',
      requestId: 'provider-request-1',
      classification: 'success',
    })
    expect(result.evidence.credentialBindingHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.evidence.configBindingHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('computes reconciliation from the server-observed provider snapshot', async () => {
    const hashA = 'a'.repeat(64)
    const hashB = 'b'.repeat(64)
    const result = await probeConnectorProvider(connector, {
      config,
      fetchFn: vi.fn().mockResolvedValue(
        Response.json({
          cursor: 'reconcile:1',
          sourceWatermark: '2026-08-10T11:59:00.000Z',
          recordCount: 2,
          snapshot: { revision: 1 },
          reconciliation: {
            sourceRecords: [
              { id: 'unit-1', contentHash: hashA },
              { id: 'unit-2', contentHash: hashA },
            ],
            targetRecords: [
              { id: 'unit-1', contentHash: hashB },
              { id: 'unit-3', contentHash: hashA },
            ],
          },
        })
      ),
      now: () => new Date('2026-08-10T12:00:00.000Z'),
    })

    expect(result.reconciliation).toMatchObject({
      status: 'drift_detected',
      missingSourceIds: ['unit-2'],
      unexpectedTargetIds: ['unit-3'],
      mismatchedIds: ['unit-1'],
      snapshotHash: result.evidence.snapshotHash,
      configBindingHash: result.evidence.configBindingHash,
    })
  })

  it('fails closed for unsupported and credential-mismatched providers', async () => {
    await expect(
      probeConnectorProvider(
        { ...connector, provider: 'invented_provider' },
        { config }
      )
    ).rejects.toMatchObject({ classification: 'unsupported_provider' })
    await expect(
      probeConnectorProvider(connector, {
        config: { ...config, credentialRef: 'vault://siteforge/yardi/other' },
      })
    ).rejects.toMatchObject({ classification: 'credential_binding_mismatch' })
  })

  it('retries transient provider failures and preserves classification', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503 }))
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(
      probeConnectorProvider(connector, { config, fetchFn, sleep })
    ).rejects.toEqual(
      expect.objectContaining<Partial<ConnectorProbeError>>({
        classification: 'provider_unavailable',
        retryable: true,
      })
    )
    expect(fetchFn).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })
})
