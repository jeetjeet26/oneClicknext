import type { Json, TablesInsert } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  createConnectorConfigSchema,
  evaluateConnectorFreshness,
  normalizeConnectorHealth,
  type ConnectorCheckpoint,
} from './contracts'
import {
  connectorConfigBindingHash,
  connectorCredentialBindingHash,
  ConnectorProbeError,
  probeConnectorProvider,
  type ConnectorProbeInput,
  type ConnectorProbeResult,
} from './provider-adapters'

type ServiceClient = ReturnType<typeof createServiceClient>
type ConnectorRow =
  import('@/types/supabase').Database['public']['Tables']['siteforge_connector_configs']['Row']

export class SiteForgeConnectorError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'SiteForgeConnectorError'
  }
}

async function loadWebsite(
  websiteId: string,
  propertyId: string,
  supabase: ServiceClient
) {
  const { data, error } = await supabase
    .from('property_websites')
    .select('id, org_id, property_id')
    .eq('id', websiteId)
    .eq('property_id', propertyId)
    .single()
  if (error || !data) {
    throw new SiteForgeConnectorError('SiteForge website not found', 404)
  }
  return data
}

function connectorView(row: ConnectorRow, now = new Date()) {
  const health = normalizeConnectorHealth(row.health)
  return {
    ...row,
    credential_ref: row.credential_ref ? 'configured' : null,
    health,
    freshness: evaluateConnectorFreshness({
      sourceWatermark: row.source_watermark,
      freshnessSeconds: row.freshness_seconds,
      now,
    }),
  }
}

export async function listConnectorConfigs(
  websiteId: string,
  propertyId: string,
  supabase: ServiceClient = createServiceClient()
) {
  await loadWebsite(websiteId, propertyId, supabase)
  const { data, error } = await supabase
    .from('siteforge_connector_configs')
    .select('*')
    .eq('website_id', websiteId)
    .eq('property_id', propertyId)
    .order('created_at', { ascending: true })
  if (error) {
    throw new SiteForgeConnectorError('Failed to load connector configs', 500)
  }
  return (data || []).map(row => connectorView(row))
}

export async function createConnectorConfig(
  input: {
    websiteId: string
    userId: string
    config: unknown
  },
  supabase: ServiceClient = createServiceClient()
) {
  const config = createConnectorConfigSchema.parse(input.config)
  const website = await loadWebsite(
    input.websiteId,
    config.propertyId,
    supabase
  )
  const health = normalizeConnectorHealth(null)
  const insert: TablesInsert<'siteforge_connector_configs'> = {
    org_id: website.org_id,
    property_id: website.property_id,
    website_id: website.id,
    provider: config.provider,
    capability: config.capability,
    status: 'draft',
    credential_ref: config.credentialRef,
    mapping: config.mapping as unknown as Json,
    health: health as unknown as Json,
    freshness_seconds: config.freshnessSeconds,
    created_by: input.userId,
  }
  const { data, error } = await supabase
    .from('siteforge_connector_configs')
    .insert(insert)
    .select('*')
    .single()
  if (error || !data) {
    if (error?.code === '23505') {
      throw new SiteForgeConnectorError(
        'A connector already exists for this provider and capability',
        409
      )
    }
    throw new SiteForgeConnectorError('Failed to persist connector config', 500)
  }
  return connectorView(data)
}

async function loadConnector(
  connectorId: string,
  websiteId: string,
  propertyId: string,
  supabase: ServiceClient
) {
  const { data, error } = await supabase
    .from('siteforge_connector_configs')
    .select('*')
    .eq('id', connectorId)
    .eq('website_id', websiteId)
    .eq('property_id', propertyId)
    .single()
  if (error || !data) {
    throw new SiteForgeConnectorError('Connector config not found', 404)
  }
  return data
}

function connectorProbeInput(connector: ConnectorRow): ConnectorProbeInput {
  return {
    connectorId: connector.id,
    websiteId: connector.website_id!,
    provider: connector.provider,
    capability: connector.capability,
    credentialRef: connector.credential_ref,
    mapping: connector.mapping,
    freshnessSeconds: connector.freshness_seconds,
    orgId: connector.org_id,
    propertyId: connector.property_id,
  }
}

async function probeConnectorOrRecordFailure(
  input: {
    connector: ConnectorRow
    connectorId: string
    websiteId: string
    propertyId: string
    requireReconciliation?: boolean
  },
  supabase: ServiceClient,
  probe: (input: ConnectorProbeInput) => Promise<ConnectorProbeResult>
) {
  try {
    if (!input.connector.credential_ref) {
      throw new ConnectorProbeError(
        'A credential reference is required before recording provider success',
        'adapter_unconfigured',
        false
      )
    }
    const bindingInput = connectorProbeInput(input.connector)
    const providerResult = await probe(bindingInput)
    if (
      providerResult.evidence.provider !== input.connector.provider ||
      providerResult.evidence.credentialBindingHash !==
        connectorCredentialBindingHash(bindingInput) ||
      providerResult.evidence.configBindingHash !==
        connectorConfigBindingHash(bindingInput) ||
      providerResult.evidence.snapshotHash !==
        providerResult.checkpoint.snapshotHash ||
      (providerResult.reconciliation != null &&
        (providerResult.reconciliation.snapshotHash !==
          providerResult.evidence.snapshotHash ||
          providerResult.reconciliation.configBindingHash !==
            providerResult.evidence.configBindingHash))
    ) {
      throw new ConnectorProbeError(
        'Provider probe evidence is not bound to the current connector configuration',
        'credential_binding_mismatch',
        false
      )
    }
    if (input.requireReconciliation && !providerResult.reconciliation) {
      throw new ConnectorProbeError(
        'Provider probe did not return a reconciliation snapshot',
        'provider_response_invalid',
        false
      )
    }
    const checkedAt = new Date(providerResult.evidence.observedAt)
    const watermark = new Date(providerResult.checkpoint.sourceWatermark)
    const capturedAt = new Date(providerResult.checkpoint.capturedAt)
    if (
      !Number.isFinite(checkedAt.getTime()) ||
      !Number.isFinite(watermark.getTime()) ||
      !Number.isFinite(capturedAt.getTime()) ||
      watermark.getTime() > checkedAt.getTime() + 5 * 60 * 1_000 ||
      Math.abs(checkedAt.getTime() - capturedAt.getTime()) > 60_000
    ) {
      throw new ConnectorProbeError(
        'Provider probe returned an invalid observation time',
        'provider_response_invalid',
        false
      )
    }
    const freshness = evaluateConnectorFreshness({
      sourceWatermark: providerResult.checkpoint.sourceWatermark,
      freshnessSeconds: input.connector.freshness_seconds,
      now: checkedAt,
    })
    if (freshness.stale) {
      throw new ConnectorProbeError(
        freshness.reason,
        'stale_snapshot',
        true
      )
    }
    return { providerResult, checkedAt }
  } catch (error) {
    const failure =
      error instanceof ConnectorProbeError
        ? error
        : new ConnectorProbeError(
            'Connector provider probe failed',
            'provider_unavailable',
            true
          )
    const failedAt = new Date().toISOString()
    await recordConnectorFailure(
      {
        connectorId: input.connectorId,
        websiteId: input.websiteId,
        propertyId: input.propertyId,
        failedAt,
        errorCode: failure.classification,
        message: failure.message,
        retryable: failure.retryable,
        checkpointCursor: null,
      },
      supabase
    )
    throw new SiteForgeConnectorError(
      failure.message,
      failure.retryable ? 503 : 409
    )
  }
}

export async function recordConnectorCheckpoint(
  input: {
    connectorId: string
    websiteId: string
    propertyId: string
    checkpoint?: ConnectorCheckpoint
    verificationEvidence?: string
  },
  supabase: ServiceClient = createServiceClient(),
  probe: (input: ConnectorProbeInput) => Promise<ConnectorProbeResult> =
    probeConnectorProvider
) {
  const connector = await loadConnector(
    input.connectorId,
    input.websiteId,
    input.propertyId,
    supabase
  )
  const { providerResult, checkedAt } = await probeConnectorOrRecordFailure(
    {
      connector,
      connectorId: input.connectorId,
      websiteId: input.websiteId,
      propertyId: input.propertyId,
    },
    supabase,
    probe
  )
  const checkpoint = providerResult.checkpoint
  const health = normalizeConnectorHealth(connector.health)
  const updatedHealth = {
    ...health,
    state: 'healthy' as const,
    verified: true,
    checkedAt: providerResult.evidence.observedAt,
    message: 'Provider health verified by the configured server adapter.',
    checkpoint,
    probe: providerResult.evidence,
    retry: {
      ...health.retry,
      attempts: 0,
      nextRetryAt: null,
      lastAttemptAt: providerResult.evidence.observedAt,
    },
    diagnostics: [
      `Server probe ${providerResult.evidence.snapshotHash} verified the provider snapshot.`,
      `Checkpoint ${checkpoint.cursor} contains ${checkpoint.recordCount} records.`,
    ],
  }
  const { data, error } = await supabase
    .from('siteforge_connector_configs')
    .update({
      status: 'active',
      health: updatedHealth as unknown as Json,
      source_watermark: checkpoint.sourceWatermark,
      last_success_at: providerResult.evidence.observedAt,
      last_error: null,
    })
    .eq('id', connector.id)
    .eq('website_id', input.websiteId)
    .eq('credential_ref', connector.credential_ref!)
    .eq('updated_at', connector.updated_at)
    .select('*')
    .single()
  if (error || !data) {
    throw new SiteForgeConnectorError(
      'Connector configuration changed during provider verification',
      409
    )
  }
  return connectorView(data, checkedAt)
}

function retryAt(attempts: number, failedAt: Date): string {
  const seconds = Math.min(3_600, 15 * 2 ** Math.max(0, attempts - 1))
  return new Date(failedAt.getTime() + seconds * 1_000).toISOString()
}

export async function recordConnectorFailure(
  input: {
    connectorId: string
    websiteId: string
    propertyId: string
    failedAt: string
    errorCode: string
    message: string
    retryable: boolean
    checkpointCursor: string | null
  },
  supabase: ServiceClient = createServiceClient()
) {
  const connector = await loadConnector(
    input.connectorId,
    input.websiteId,
    input.propertyId,
    supabase
  )
  const health = normalizeConnectorHealth(connector.health)
  const attempts = health.retry.attempts + 1
  const deadLettered = !input.retryable || attempts >= health.retry.maxAttempts
  const failedAt = new Date(input.failedAt)
  const updatedHealth = {
    ...health,
    state: deadLettered ? ('error' as const) : ('degraded' as const),
    verified: false,
    checkedAt: input.failedAt,
    message: input.message,
    retry: {
      ...health.retry,
      attempts,
      nextRetryAt: deadLettered ? null : retryAt(attempts, failedAt),
      lastAttemptAt: input.failedAt,
    },
    deadLetters: deadLettered
      ? [
          ...health.deadLetters.slice(-99),
          {
            checkpointCursor: input.checkpointCursor,
            failedAt: input.failedAt,
            errorCode: input.errorCode,
            message: input.message,
            attempts,
          },
        ]
      : health.deadLetters,
    diagnostics: [
      `${input.errorCode}: ${input.message}`,
      deadLettered
        ? 'Failure requires operator reconciliation.'
        : `Retry ${attempts} scheduled with bounded exponential backoff.`,
    ],
  }
  const { data, error } = await supabase
    .from('siteforge_connector_configs')
    .update({
      status: deadLettered ? 'error' : 'degraded',
      health: updatedHealth as unknown as Json,
      last_error_at: input.failedAt,
      last_error: `${input.errorCode}: ${input.message}`,
    })
    .eq('id', connector.id)
    .eq('website_id', input.websiteId)
    .select('*')
    .single()
  if (error || !data) {
    throw new SiteForgeConnectorError('Failed to persist connector failure', 500)
  }
  return connectorView(data, failedAt)
}

export async function recordConnectorReconciliation(
  input: {
    connectorId: string
    websiteId: string
    propertyId: string
  },
  supabase: ServiceClient = createServiceClient(),
  probe: (input: ConnectorProbeInput) => Promise<ConnectorProbeResult> =
    probeConnectorProvider
) {
  const connector = await loadConnector(
    input.connectorId,
    input.websiteId,
    input.propertyId,
    supabase
  )
  const { providerResult, checkedAt } = await probeConnectorOrRecordFailure(
    {
      connector,
      connectorId: input.connectorId,
      websiteId: input.websiteId,
      propertyId: input.propertyId,
      requireReconciliation: true,
    },
    supabase,
    probe
  )
  const reconciliation = providerResult.reconciliation!
  const health = normalizeConnectorHealth(connector.health)
  const drifted = reconciliation.status === 'drift_detected'
  const diagnostics = drifted
    ? [
        `${reconciliation.missingSourceIds.length} source records are missing from the target.`,
        `${reconciliation.unexpectedTargetIds.length} unexpected target records were found.`,
        `${reconciliation.mismatchedIds.length} records have mapping differences.`,
      ]
    : [
        'Source and target record identities reconciled without drift.',
        `Server probe ${providerResult.evidence.snapshotHash} verified the reconciliation snapshot.`,
      ]
  const updatedHealth = {
    ...health,
    state: drifted ? ('degraded' as const) : ('healthy' as const),
    verified: !drifted,
    checkedAt: providerResult.evidence.observedAt,
    message: drifted
      ? 'Provider reconciliation detected drift.'
      : 'Provider reconciliation verified by the configured server adapter.',
    checkpoint: providerResult.checkpoint,
    probe: providerResult.evidence,
    reconciliation,
    retry: {
      ...health.retry,
      attempts: 0,
      nextRetryAt: null,
      lastAttemptAt: providerResult.evidence.observedAt,
    },
    diagnostics,
  }
  const { data, error } = await supabase
    .from('siteforge_connector_configs')
    .update({
      status: drifted ? 'degraded' : 'active',
      health: updatedHealth as unknown as Json,
      source_watermark: providerResult.checkpoint.sourceWatermark,
      last_success_at: providerResult.evidence.observedAt,
      last_error: null,
    })
    .eq('id', connector.id)
    .eq('website_id', input.websiteId)
    .eq('credential_ref', connector.credential_ref!)
    .eq('updated_at', connector.updated_at)
    .select('*')
    .single()
  if (error || !data) {
    throw new SiteForgeConnectorError(
      'Connector configuration changed during provider reconciliation',
      409
    )
  }
  return connectorView(data, checkedAt)
}
