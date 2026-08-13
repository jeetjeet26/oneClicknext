import { z } from 'zod'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import type { ConnectorCheckpoint } from './contracts'

const SUPPORTED_PROVIDERS = new Set([
  'entrata',
  'ga4',
  'google_maps',
  'google_tag_manager',
  'lasso',
  'realpage',
  'yardi',
])
const MAX_PROBE_ATTEMPTS = 3

const adapterConfigSchema = z
  .object({
    provider: z.string().trim().toLowerCase(),
    credentialRef: z.string().trim().min(1),
    probeUrl: z
      .url()
      .refine(value => new URL(value).protocol === 'https:', {
        message: 'Connector probes require HTTPS',
      }),
    accessToken: z.string().min(1),
  })
  .strict()

const providerSnapshotSchema = z
  .object({
    cursor: z.string().trim().min(1).max(2_000),
    sourceWatermark: z.iso.datetime(),
    recordCount: z.number().int().nonnegative(),
    snapshot: z.json(),
    reconciliation: z
      .object({
        sourceRecords: z
          .array(
            z
              .object({
                id: z.string().trim().min(1).max(500),
                contentHash: z.string().regex(/^[a-f0-9]{64}$/),
              })
              .strict()
          )
          .max(10_000),
        targetRecords: z
          .array(
            z
              .object({
                id: z.string().trim().min(1).max(500),
                contentHash: z.string().regex(/^[a-f0-9]{64}$/),
              })
              .strict()
          )
          .max(10_000),
      })
      .strict()
      .superRefine((value, context) => {
        for (const [key, records] of [
          ['sourceRecords', value.sourceRecords],
          ['targetRecords', value.targetRecords],
        ] as const) {
          const seen = new Set<string>()
          records.forEach((record, index) => {
            if (seen.has(record.id)) {
              context.addIssue({
                code: 'custom',
                path: [key, index, 'id'],
                message: 'Reconciliation record identifiers must be unique',
              })
            }
            seen.add(record.id)
          })
        }
      })
      .optional(),
    requestId: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .strict()

export type ConnectorProbeFailureClassification =
  | 'unsupported_provider'
  | 'adapter_unconfigured'
  | 'credential_binding_mismatch'
  | 'credential_rejected'
  | 'provider_rate_limited'
  | 'provider_unavailable'
  | 'provider_response_invalid'
  | 'provider_rejected'
  | 'stale_snapshot'

export class ConnectorProbeError extends Error {
  constructor(
    message: string,
    readonly classification: ConnectorProbeFailureClassification,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'ConnectorProbeError'
  }
}

export type ConnectorProbeResult = {
  checkpoint: ConnectorCheckpoint
  evidence: {
    adapterVersion: 'siteforge-connector-probe-v1'
    provider: string
    credentialBindingHash: string
    configBindingHash: string
    observedAt: string
    snapshotHash: string
    requestId: string | null
    classification: 'success'
  }
  reconciliation: {
    reconciledAt: string
    snapshotHash: string
    configBindingHash: string
    sourceCount: number
    targetCount: number
    missingSourceIds: string[]
    unexpectedTargetIds: string[]
    mismatchedIds: string[]
    status: 'matched' | 'drift_detected'
  } | null
}

type FetchLike = typeof fetch
type Sleep = (milliseconds: number) => Promise<void>

export type ConnectorProbeInput = {
  connectorId: string
  websiteId: string
  provider: string
  capability: string
  credentialRef: string | null
  mapping: unknown
  freshnessSeconds: number | null
  orgId: string
  propertyId: string
}

export function connectorCredentialBindingHash(
  input: Pick<
    ConnectorProbeInput,
    'provider' | 'credentialRef' | 'orgId' | 'propertyId'
  >
) {
  return hashSiteForgeContent({
    provider: input.provider,
    credentialRef: input.credentialRef,
    orgId: input.orgId,
    propertyId: input.propertyId,
  })
}

export function connectorConfigBindingHash(input: ConnectorProbeInput) {
  return hashSiteForgeContent({
    connectorId: input.connectorId,
    websiteId: input.websiteId,
    provider: input.provider,
    capability: input.capability,
    credentialBindingHash: connectorCredentialBindingHash(input),
    mapping: input.mapping,
    freshnessSeconds: input.freshnessSeconds,
  })
}

function providerEnvKey(provider: string) {
  return `SITEFORGE_CONNECTOR_${provider.toUpperCase().replaceAll('-', '_')}_PROBE`
}

function loadAdapterConfig(provider: string) {
  const serialized = process.env[providerEnvKey(provider)]
  if (!serialized) {
    throw new ConnectorProbeError(
      'Connector provider adapter is not configured',
      'adapter_unconfigured',
      false
    )
  }
  try {
    return adapterConfigSchema.parse(JSON.parse(serialized))
  } catch {
    throw new ConnectorProbeError(
      'Connector provider adapter configuration is invalid',
      'adapter_unconfigured',
      false
    )
  }
}

function classifyHttpFailure(status: number): ConnectorProbeError {
  if (status === 401 || status === 403) {
    return new ConnectorProbeError(
      'Connector provider rejected its configured credential',
      'credential_rejected',
      false
    )
  }
  if (status === 429) {
    return new ConnectorProbeError(
      'Connector provider rate limited the health probe',
      'provider_rate_limited',
      true
    )
  }
  if (status >= 500) {
    return new ConnectorProbeError(
      'Connector provider is unavailable',
      'provider_unavailable',
      true
    )
  }
  return new ConnectorProbeError(
    'Connector provider rejected the health probe',
    'provider_rejected',
    false
  )
}

export async function probeConnectorProvider(
  input: ConnectorProbeInput,
  options?: {
    fetchFn?: FetchLike
    sleep?: Sleep
    now?: () => Date
    config?: unknown
  }
): Promise<ConnectorProbeResult> {
  if (!SUPPORTED_PROVIDERS.has(input.provider)) {
    throw new ConnectorProbeError(
      'Connector provider is unsupported',
      'unsupported_provider',
      false
    )
  }
  if (!input.credentialRef) {
    throw new ConnectorProbeError(
      'Connector credential reference is not configured',
      'adapter_unconfigured',
      false
    )
  }

  const config = options?.config
    ? adapterConfigSchema.parse(options.config)
    : loadAdapterConfig(input.provider)
  if (
    config.provider !== input.provider ||
    config.credentialRef !== input.credentialRef
  ) {
    throw new ConnectorProbeError(
      'Connector credential reference does not match the provider adapter',
      'credential_binding_mismatch',
      false
    )
  }

  const fetchFn = options?.fetchFn || fetch
  const sleep =
    options?.sleep ||
    ((milliseconds: number) =>
      new Promise(resolve => setTimeout(resolve, milliseconds)))
  let response: Response | null = null
  for (let attempt = 1; attempt <= MAX_PROBE_ATTEMPTS; attempt += 1) {
    try {
      response = await fetchFn(config.probeUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          Accept: 'application/json',
          'X-SiteForge-Probe': 'siteforge-connector-probe-v1',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      if (attempt === MAX_PROBE_ATTEMPTS) {
        throw new ConnectorProbeError(
          'Connector provider is unavailable',
          'provider_unavailable',
          true
        )
      }
      await sleep(100 * 2 ** (attempt - 1))
      continue
    }
    if (response.ok) break
    const failure = classifyHttpFailure(response.status)
    if (!failure.retryable || attempt === MAX_PROBE_ATTEMPTS) throw failure
    await sleep(100 * 2 ** (attempt - 1))
  }

  let snapshot: z.infer<typeof providerSnapshotSchema>
  try {
    snapshot = providerSnapshotSchema.parse(await response!.json())
  } catch {
    throw new ConnectorProbeError(
      'Connector provider returned an invalid probe snapshot',
      'provider_response_invalid',
      false
    )
  }

  const observedAt = (options?.now?.() || new Date()).toISOString()
  const snapshotHash = hashSiteForgeContent({
    provider: input.provider,
    cursor: snapshot.cursor,
    sourceWatermark: snapshot.sourceWatermark,
    recordCount: snapshot.recordCount,
    snapshot: snapshot.snapshot,
    reconciliation: snapshot.reconciliation || null,
  })
  const credentialBindingHash = connectorCredentialBindingHash(input)
  const configBindingHash = connectorConfigBindingHash(input)
  const sourceRecords = new Map(
    snapshot.reconciliation?.sourceRecords.map(record => [
      record.id,
      record.contentHash,
    ]) || []
  )
  const targetRecords = new Map(
    snapshot.reconciliation?.targetRecords.map(record => [
      record.id,
      record.contentHash,
    ]) || []
  )
  const missingSourceIds = [...sourceRecords.keys()]
    .filter(id => !targetRecords.has(id))
    .sort()
  const unexpectedTargetIds = [...targetRecords.keys()]
    .filter(id => !sourceRecords.has(id))
    .sort()
  const mismatchedIds = [...sourceRecords]
    .filter(([id, contentHash]) => {
      const targetHash = targetRecords.get(id)
      return targetHash !== undefined && targetHash !== contentHash
    })
    .map(([id]) => id)
    .sort()
  const drifted =
    missingSourceIds.length > 0 ||
    unexpectedTargetIds.length > 0 ||
    mismatchedIds.length > 0

  return {
    checkpoint: {
      cursor: snapshot.cursor,
      sourceWatermark: snapshot.sourceWatermark,
      capturedAt: observedAt,
      recordCount: snapshot.recordCount,
      snapshotHash,
    },
    evidence: {
      adapterVersion: 'siteforge-connector-probe-v1',
      provider: input.provider,
      credentialBindingHash,
      configBindingHash,
      observedAt,
      snapshotHash,
      requestId: snapshot.requestId || null,
      classification: 'success',
    },
    reconciliation: snapshot.reconciliation
      ? {
          reconciledAt: observedAt,
          snapshotHash,
          configBindingHash,
          sourceCount: sourceRecords.size,
          targetCount: targetRecords.size,
          missingSourceIds,
          unexpectedTargetIds,
          mismatchedIds,
          status: drifted ? 'drift_detected' : 'matched',
        }
      : null,
  }
}
