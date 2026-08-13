import { z } from 'zod'

export const connectorCapabilitySchema = z.enum([
  'conversion',
  'inventory',
  'analytics',
  'tag_manager',
  'maps',
  'accessibility',
])

export const connectorStatusSchema = z.enum([
  'draft',
  'active',
  'degraded',
  'paused',
  'revoked',
  'error',
])

export const connectorCredentialRefSchema = z
  .string()
  .trim()
  .max(500)
  .regex(
    /^(?:vault:\/\/siteforge\/[a-z0-9/_-]+|integration:\/\/[0-9a-f-]{36})$/i,
    'Use a vault://siteforge/ or integration:// credential reference'
  )

export const connectorMappingSchema = z
  .object({
    version: z.number().int().positive(),
    fields: z
      .array(
        z
          .object({
            source: z.string().trim().min(1).max(200),
            target: z.string().trim().min(1).max(200),
            required: z.boolean().default(false),
            transform: z
              .enum([
                'identity',
                'trim',
                'lowercase',
                'uppercase',
                'integer',
                'decimal',
                'iso_datetime',
              ])
              .default('identity'),
          })
          .strict()
      )
      .max(500),
    validatedAt: z.iso.datetime().nullable().default(null),
    validationEvidence: z
      .array(z.string().trim().min(1).max(500))
      .max(100)
      .default([]),
  })
  .strict()

export const connectorCheckpointSchema = z
  .object({
    cursor: z.string().trim().min(1).max(2_000),
    sourceWatermark: z.iso.datetime(),
    capturedAt: z.iso.datetime(),
    recordCount: z.number().int().nonnegative(),
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

export const connectorProbeEvidenceSchema = z
  .object({
    adapterVersion: z.literal('siteforge-connector-probe-v1'),
    provider: z.string().trim().min(1).max(100),
    credentialBindingHash: z.string().regex(/^[a-f0-9]{64}$/),
    configBindingHash: z.string().regex(/^[a-f0-9]{64}$/),
    observedAt: z.iso.datetime(),
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
    requestId: z.string().trim().min(1).max(500).nullable(),
    classification: z.literal('success'),
  })
  .strict()

export const connectorRetrySchema = z
  .object({
    attempts: z.number().int().nonnegative(),
    maxAttempts: z.number().int().min(1).max(50),
    nextRetryAt: z.iso.datetime().nullable(),
    lastAttemptAt: z.iso.datetime().nullable(),
  })
  .strict()

export const connectorDeadLetterSchema = z
  .object({
    checkpointCursor: z.string().trim().min(1).max(2_000).nullable(),
    failedAt: z.iso.datetime(),
    errorCode: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(2_000),
    attempts: z.number().int().positive(),
  })
  .strict()

export const connectorReconciliationSchema = z
  .object({
    reconciledAt: z.iso.datetime(),
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
    configBindingHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceCount: z.number().int().nonnegative(),
    targetCount: z.number().int().nonnegative(),
    missingSourceIds: z.array(z.string().trim().min(1).max(500)).max(10_000),
    unexpectedTargetIds: z.array(z.string().trim().min(1).max(500)).max(10_000),
    mismatchedIds: z.array(z.string().trim().min(1).max(500)).max(10_000),
    status: z.enum(['matched', 'drift_detected']),
  })
  .strict()

export const connectorHealthSchema = z
  .object({
    state: z.enum(['unknown', 'healthy', 'stale', 'degraded', 'error', 'revoked']),
    verified: z.boolean(),
    checkedAt: z.iso.datetime().nullable(),
    message: z.string().trim().max(2_000).nullable(),
    checkpoint: connectorCheckpointSchema.nullable(),
    probe: connectorProbeEvidenceSchema.nullable().default(null),
    retry: connectorRetrySchema,
    deadLetters: z.array(connectorDeadLetterSchema).max(100),
    reconciliation: connectorReconciliationSchema.nullable(),
    diagnostics: z.array(z.string().trim().min(1).max(2_000)).max(100),
  })
  .strict()

export const createConnectorConfigSchema = z
  .object({
    propertyId: z.guid(),
    provider: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9_-]{1,99}$/),
    capability: connectorCapabilitySchema,
    credentialRef: connectorCredentialRefSchema.nullable().default(null),
    mapping: connectorMappingSchema,
    freshnessSeconds: z.number().int().min(60).max(2_592_000).nullable(),
  })
  .strict()

export const connectorCheckpointInputSchema = z
  .object({
    action: z.literal('checkpoint'),
    propertyId: z.guid(),
    // Legacy fields remain parseable during rollout, but are never trusted.
    // The server replaces them with a provider-adapter probe result.
    checkpoint: connectorCheckpointSchema.optional(),
    verificationEvidence: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict()

export const connectorProbeInputSchema = z
  .object({
    action: z.literal('probe'),
    propertyId: z.guid(),
  })
  .strict()

export const connectorFailureInputSchema = z
  .object({
    action: z.literal('failure'),
    propertyId: z.guid(),
    failedAt: z.iso.datetime(),
    errorCode: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(2_000),
    retryable: z.boolean(),
    checkpointCursor: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict()

export const connectorReconciliationInputSchema = z
  .object({
    action: z.literal('reconcile'),
    propertyId: z.guid(),
  })
  .strict()

export const connectorCommandSchema = z.discriminatedUnion('action', [
  connectorCheckpointInputSchema,
  connectorProbeInputSchema,
  connectorFailureInputSchema,
  connectorReconciliationInputSchema,
])

export const DEFAULT_CONNECTOR_HEALTH = Object.freeze({
  state: 'unknown' as const,
  verified: false,
  checkedAt: null,
  message: 'Provider health has not been verified.',
  checkpoint: null,
  probe: null,
  retry: {
    attempts: 0,
    maxAttempts: 8,
    nextRetryAt: null,
    lastAttemptAt: null,
  },
  deadLetters: [],
  reconciliation: null,
  diagnostics: ['No provider request has been made.'],
})

export type ConnectorHealth = z.infer<typeof connectorHealthSchema>
export type ConnectorCheckpoint = z.infer<typeof connectorCheckpointSchema>
export type ConnectorReconciliation = z.infer<
  typeof connectorReconciliationSchema
>

export function normalizeConnectorHealth(value: unknown): ConnectorHealth {
  const parsed = connectorHealthSchema.safeParse(value)
  return parsed.success
    ? parsed.data
    : connectorHealthSchema.parse(DEFAULT_CONNECTOR_HEALTH)
}

export function evaluateConnectorFreshness(input: {
  sourceWatermark: string | null
  freshnessSeconds: number | null
  now?: Date
}) {
  const now = input.now || new Date()
  if (!input.sourceWatermark || !input.freshnessSeconds) {
    return Object.freeze({
      state: 'unknown' as const,
      stale: true,
      ageSeconds: null,
      reason: 'No durable source watermark or freshness contract is available.',
    })
  }
  const sourceTime = new Date(input.sourceWatermark).getTime()
  if (!Number.isFinite(sourceTime)) {
    return Object.freeze({
      state: 'invalid' as const,
      stale: true,
      ageSeconds: null,
      reason: 'The durable source watermark is invalid.',
    })
  }
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - sourceTime) / 1_000))
  const stale = ageSeconds > input.freshnessSeconds
  return Object.freeze({
    state: stale ? ('stale' as const) : ('fresh' as const),
    stale,
    ageSeconds,
    reason: stale
      ? `Source data exceeds the ${input.freshnessSeconds}-second freshness contract.`
      : 'Source data is within the configured freshness contract.',
  })
}
