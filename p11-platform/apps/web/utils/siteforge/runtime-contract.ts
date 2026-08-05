import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  acfBlockTypeSchema,
  isSiteForgeBlockVariant,
  siteConfigurationSchema,
  siteForgeCssClassSchema,
} from '@/types/siteforge'
import {
  canonicalizeSiteForgeContent,
  hashSiteForgeContent,
} from '@/utils/siteforge/content-hash'

export const SITEFORGE_RUNTIME_CONTRACT_VERSION = 2 as const
export const SITEFORGE_RUNTIME_NAMESPACE = 'siteforge/v2' as const

export const runtimeContractVersionSchema = z.literal(
  SITEFORGE_RUNTIME_CONTRACT_VERSION
)
export const runtimeHashSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const runtimeIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
export const runtimeArtifactIdSchema = z.string().uuid()

export const runtimeFailureCodeSchema = z.enum([
  'unauthorized',
  'forbidden',
  'unsupported_contract',
  'capability_mismatch',
  'stale_remote_state',
  'idempotency_conflict',
  'invalid_artifact',
  'invalid_asset',
  'asset_hash_mismatch',
  'invalid_plan',
  'operation_failed',
  'deployment_not_found',
  'runtime_unavailable',
  'rate_limited',
  'internal_error',
  'invalid_response',
])

export const runtimeFailureSchema = z
  .object({
    code: runtimeFailureCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
    stage: z
      .enum([
        'authentication',
        'health',
        'capabilities',
        'state',
        'asset_preparation',
        'preflight',
        'pages',
        'settings',
        'navigation',
        'removals',
        'verification',
        'manifest',
        'rollback',
      ])
      .optional(),
    operationHash: runtimeHashSchema.optional(),
    expectedRemoteContentHash: runtimeHashSchema.nullable().optional(),
    actualRemoteContentHash: runtimeHashSchema.nullable().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const runtimeErrorResponseSchema = z
  .object({
    contractVersion: runtimeContractVersionSchema.optional(),
    error: runtimeFailureSchema,
    requestId: z.string().min(1).optional(),
  })
  .strict()

export const runtimeHealthSchema = z
  .object({
    contractVersion: runtimeContractVersionSchema,
    runtimeVersion: z.string().min(1),
    status: z.enum(['ok', 'degraded', 'unavailable']),
    checkedAt: z.string().datetime({ offset: true }),
    dependencies: z.array(
      z
        .object({
          name: z.string().min(1),
          status: z.enum(['ok', 'degraded', 'unavailable']),
          message: z.string().min(1).optional(),
        })
        .strict()
    ),
  })
  .strict()

export const runtimeCapabilitiesSchema = z
  .object({
    contractVersion: runtimeContractVersionSchema,
    runtimeVersion: z.string().min(1),
    provider: z.literal('wordpress'),
    authentication: z.literal('wordpress_application_password'),
    features: z
      .object({
        immutableAssetPreparation: z.literal(true),
        optimisticConcurrency: z.literal(true),
        idempotentDeployments: z.literal(true),
        transactionalRollback: z.literal(true),
        pageRemovals: z.literal(true),
        navigationMutation: z.literal(true),
        designTokenMutation: z.literal(true),
        siteSettingsMutation: z.literal(true),
        legalMutation: z.literal(true),
        analyticsMutation: z.literal(true),
      })
      .strict(),
    limits: z
      .object({
        maxAssetsPerPreparation: z.number().int().positive(),
        maxAssetBytes: z.number().int().positive(),
        maxPagesPerDeployment: z.number().int().positive(),
        acceptedAssetMimeTypes: z.array(z.string().min(1)),
      })
      .strict(),
  })
  .strict()

export const immutableRuntimeAssetSchema = z
  .object({
    assetId: z.string().uuid(),
    sourceUrl: z.string().url(),
    byteHash: runtimeHashSchema,
    bytes: z.number().int().positive(),
    mimeType: z.string().min(1).max(100),
    filename: z
      .string()
      .min(1)
      .max(255)
      .refine(
        value => !value.includes('/') && !value.includes('\\'),
        'Asset filename must not contain a path'
      ),
    role: z.string().min(1).max(100),
    altText: z.string().max(2_000).nullable(),
    caption: z.string().max(10_000).nullable(),
  })
  .strict()

const immutableRuntimeAssetIdentitySchema = immutableRuntimeAssetSchema.omit({
  sourceUrl: true,
})

export const assetPreparationRequestSchema = z
  .object({
    contractVersion: runtimeContractVersionSchema,
    siteId: runtimeIdSchema,
    artifactId: runtimeArtifactIdSchema,
    artifactContentHash: runtimeHashSchema,
    assetManifestHash: runtimeHashSchema,
    idempotencyKey: runtimeHashSchema,
    assets: z.array(immutableRuntimeAssetSchema).max(100),
  })
  .strict()
  .superRefine((request, context) => {
    addAssetIssues(request.assets, context)
    if (deriveAssetManifestHash(request.assets) !== request.assetManifestHash) {
      context.addIssue({
        code: 'custom',
        path: ['assetManifestHash'],
        message: 'assetManifestHash does not match immutable asset identities',
      })
    }
    const expected = deriveRuntimeIdempotencyKey('asset_preparation', {
      siteId: request.siteId,
      artifactId: request.artifactId,
      artifactContentHash: request.artifactContentHash,
      payloadHash: request.assetManifestHash,
    })
    if (expected !== request.idempotencyKey) {
      context.addIssue({
        code: 'custom',
        path: ['idempotencyKey'],
        message: 'Asset preparation idempotencyKey does not match its payload',
      })
    }
  })

export const preparedRuntimeAssetSchema = z
  .object({
    assetId: z.string().uuid(),
    byteHash: runtimeHashSchema,
    attachmentId: z.number().int().positive(),
    url: z.string().url(),
    mimeType: z.string().min(1),
    disposition: z.enum(['created', 'reused']),
  })
  .strict()

export const assetPreparationResultSchema = z
  .object({
    contractVersion: runtimeContractVersionSchema,
    preparationId: runtimeIdSchema,
    siteId: runtimeIdSchema,
    artifactId: runtimeArtifactIdSchema,
    artifactContentHash: runtimeHashSchema,
    assetManifestHash: runtimeHashSchema,
    idempotencyKey: runtimeHashSchema,
    assets: z.array(preparedRuntimeAssetSchema),
    preparedAt: z.string().datetime({ offset: true }),
  })
  .strict()

export const runtimeSectionSchema = z
  .object({
    sectionId: runtimeIdSchema,
    blockName: acfBlockTypeSchema,
    order: z.number().int().nonnegative(),
    variant: z.string().min(1).nullable(),
    cssClasses: z.array(siteForgeCssClassSchema).max(20).optional(),
    anchor: runtimeIdSchema.optional(),
    align: z.enum(['wide', 'full']).optional(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((section, context) => {
    if (
      section.variant &&
      !isSiteForgeBlockVariant(section.blockName, section.variant)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['variant'],
        message: `Unsupported ${section.blockName} variant "${section.variant}"`,
      })
    }
  })

export const runtimeSeoSchema = z
  .object({
    title: z.string().min(1).max(500),
    description: z.string().max(10_000),
    canonicalPath: z
      .string()
      .regex(
        /^\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%-]+\/?)*$/,
        'canonicalPath must be a root-relative path without query or fragment'
      ),
    noIndex: z.boolean(),
    structuredData: z
      .array(
        z.string().refine(isRuntimeJsonLd, {
          message: 'structuredData entries must contain JSON objects or arrays',
        })
      )
      .max(100),
  })
  .strict()

export const runtimePageSchema = z
  .object({
    pageKey: runtimeIdSchema,
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().min(1).max(500),
    purpose: z.string().max(10_000),
    status: z.enum(['publish', 'draft', 'private']),
    menuOrder: z.number().int().nonnegative(),
    template: z.string().max(255),
    excerpt: z.string().max(10_000),
    seo: runtimeSeoSchema.nullable(),
    sections: z.array(runtimeSectionSchema),
  })
  .strict()

export const runtimeRemovalsSchema = z
  .object({
    pageKeys: z.array(runtimeIdSchema).max(200),
    pageSlugs: z
      .array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))
      .max(200),
  })
  .strict()

export const runtimeNavigationItemSchema = z
  .object({
    itemKey: runtimeIdSchema,
    label: z.string().min(1).max(500),
    pageKey: runtimeIdSchema.nullable(),
    url: z
      .string()
      .min(1)
      .max(2_048)
      .refine(
        value => value.startsWith('/') || /^https?:\/\//i.test(value),
        'Navigation URLs must be root-relative or HTTP(S)'
      )
      .nullable(),
    parentItemKey: runtimeIdSchema.nullable(),
    target: z.enum(['_self', '_blank']),
  })
  .strict()
  .refine(item => (item.pageKey === null) !== (item.url === null), {
    message: 'Navigation items require exactly one pageKey or URL',
  })

export const runtimeNavigationSchema = z
  .object({
    location: runtimeIdSchema,
    name: z.string().min(1).max(200),
    items: z.array(runtimeNavigationItemSchema).max(200),
  })
  .strict()
  .superRefine((navigation, context) => {
    const keys = new Set<string>()
    navigation.items.forEach((item, index) => {
      if (keys.has(item.itemKey)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'itemKey'],
          message: 'Navigation item keys must be unique',
        })
      }
      keys.add(item.itemKey)
    })

    const parentByKey = new Map(
      navigation.items.map(item => [item.itemKey, item.parentItemKey] as const)
    )
    navigation.items.forEach((item, index) => {
      if (item.parentItemKey && !keys.has(item.parentItemKey)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'parentItemKey'],
          message: 'Navigation parents must reference another item',
        })
        return
      }
      const visited = new Set<string>()
      let cursor: string | null = item.itemKey
      while (cursor !== null) {
        if (visited.has(cursor)) {
          context.addIssue({
            code: 'custom',
            path: ['items', index, 'parentItemKey'],
            message: 'Navigation hierarchy must not contain cycles',
          })
          break
        }
        visited.add(cursor)
        cursor = parentByKey.get(cursor) ?? null
      }
    })
  })

export const runtimeDesignTokensSchema = siteConfigurationSchema.shape.design

export const runtimePropertyProfileSchema = z
  .object({
    name: z.string().min(1).max(500),
    address: z.string().max(2_000),
    phone: z.string().max(100),
    email: z.string().email().or(z.literal('')),
    socialLinks: z.record(z.string(), z.string().url()),
  })
  .strict()

export const runtimeSiteSettingsSchema = z
  .object({
    siteName: z.string().min(1).max(500),
    tagline: z.string().max(2_000),
    homepagePageKey: runtimeIdSchema,
    logoAssetId: z.string().uuid().nullable(),
    faviconAssetId: z.string().uuid().nullable(),
    propertyProfile: runtimePropertyProfileSchema.optional(),
  })
  .strict()

const httpsRuntimeUrlSchema = z
  .string()
  .url()
  .refine(value => new URL(value).protocol === 'https:', {
    message: 'Public runtime URLs must use HTTPS',
  })

export const runtimeTargetStateSchema = z
  .object({
    mode: z.enum(['canonical_preview', 'staging', 'production']),
    siteUrl: z.string().url(),
  })
  .strict()

export const runtimePublicRuntimeSchema = z
  .object({
    enabled: z.boolean(),
    apiKey: z.string().max(2_000),
    apiBaseUrl: httpsRuntimeUrlSchema,
    websiteId: z.string().uuid(),
    conversionEndpoint: httpsRuntimeUrlSchema,
    conversionKey: z.string().min(1).max(2_000),
    telemetryEndpoint: httpsRuntimeUrlSchema,
  })
  .strict()
  .superRefine((runtime, context) => {
    if (runtime.enabled && runtime.apiKey.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['apiKey'],
        message: 'Enabled public runtime requires an API key',
      })
    }
  })

export const runtimeProtectionStateSchema = z
  .object({
    mode: z.enum(['noindex', 'password_noindex', 'public']),
  })
  .strict()

export const compiledMutationPlanSchema = z
  .object({
    pages: z.array(runtimePageSchema).max(200),
    removals: runtimeRemovalsSchema,
    navigation: runtimeNavigationSchema,
    designTokens: runtimeDesignTokensSchema,
    siteSettings: runtimeSiteSettingsSchema,
    legal: z.record(z.string(), z.unknown()),
    analytics: z.record(z.string(), z.unknown()),
    siteConfiguration: siteConfigurationSchema.optional(),
    target: runtimeTargetStateSchema.optional(),
    publicRuntime: runtimePublicRuntimeSchema.optional(),
    protection: runtimeProtectionStateSchema.optional(),
  })
  .strict()
  .superRefine((plan, context) => {
    const pageKeys = new Set(plan.pages.map(page => page.pageKey))
    const pageSlugs = new Set(plan.pages.map(page => page.slug))
    if (pageKeys.size !== plan.pages.length || pageSlugs.size !== plan.pages.length) {
      context.addIssue({
        code: 'custom',
        path: ['pages'],
        message: 'Compiled page keys and slugs must be unique',
      })
    }
    if (!pageKeys.has(plan.siteSettings.homepagePageKey)) {
      context.addIssue({
        code: 'custom',
        path: ['siteSettings', 'homepagePageKey'],
        message: 'homepagePageKey must reference a desired page',
      })
    }
    plan.removals.pageKeys.forEach((pageKey, index) => {
      if (pageKeys.has(pageKey)) {
        context.addIssue({
          code: 'custom',
          path: ['removals', 'pageKeys', index],
          message: 'A desired page cannot also be removed',
        })
      }
    })
    plan.removals.pageSlugs.forEach((slug, index) => {
      if (pageSlugs.has(slug)) {
        context.addIssue({
          code: 'custom',
          path: ['removals', 'pageSlugs', index],
          message: 'A desired page cannot also be removed',
        })
      }
    })
  })

export const deploymentSubmissionSchema = z
  .object({
    contractVersion: runtimeContractVersionSchema,
    siteId: runtimeIdSchema,
    artifactId: runtimeArtifactIdSchema,
    artifactContentHash: runtimeHashSchema,
    assetManifestHash: runtimeHashSchema,
    operationHash: runtimeHashSchema,
    idempotencyKey: runtimeHashSchema,
    expectedRemoteContentHash: runtimeHashSchema.nullable(),
    assetPreparationId: runtimeIdSchema,
    plan: compiledMutationPlanSchema,
  })
  .strict()
  .superRefine((submission, context) => {
    if (deriveRuntimeOperationHash(submission.plan) !== submission.operationHash) {
      context.addIssue({
        code: 'custom',
        path: ['operationHash'],
        message: 'operationHash does not match the compiled desired-state plan',
      })
    }
    const expected = deriveRuntimeIdempotencyKey('deployment', {
      siteId: submission.siteId,
      artifactId: submission.artifactId,
      artifactContentHash: submission.artifactContentHash,
      expectedRemoteContentHash: submission.expectedRemoteContentHash,
      payloadHash: submission.operationHash,
    })
    if (expected !== submission.idempotencyKey) {
      context.addIssue({
        code: 'custom',
        path: ['idempotencyKey'],
        message: 'Deployment idempotencyKey does not match its payload',
      })
    }
  })

export const runtimeMediaBindingSchema = z
  .object({
    attachmentId: z.number().int().positive(),
    url: z.string().url(),
    byteHash: runtimeHashSchema,
    mimeType: z.string().min(1),
  })
  .strict()

export const runtimeVerificationSchema = z
  .object({
    verified: z.boolean(),
    checks: z.array(
      z
        .object({
          name: z.string().min(1),
          passed: z.boolean(),
          message: z.string().min(1),
        })
        .strict()
    ),
    verifiedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()

export const runtimeRollbackSchema = z
  .object({
    attempted: z.boolean(),
    succeeded: z.boolean().nullable(),
    restoredContentHash: runtimeHashSchema.nullable(),
    failure: runtimeFailureSchema.nullable(),
  })
  .strict()

export const deploymentLifecycleStatusSchema = z.enum([
  'running',
  'succeeded',
  'failed',
])

export const deploymentPhaseSchema = z.enum([
  'preflight',
  'pages',
  'settings',
  'navigation',
  'removals',
  'verification',
  'manifest',
  'rollback',
  'complete',
])

export const deploymentStatusSchema = z
  .object({
    contractVersion: runtimeContractVersionSchema,
    transactionId: z.string().uuid(),
    status: deploymentLifecycleStatusSchema,
    phase: deploymentPhaseSchema,
    siteId: runtimeIdSchema,
    artifactId: runtimeArtifactIdSchema,
    artifactContentHash: runtimeHashSchema,
    assetManifestHash: runtimeHashSchema,
    operationHash: runtimeHashSchema,
    idempotencyKey: runtimeHashSchema,
    expectedRemoteContentHash: runtimeHashSchema.nullable(),
    previousRemoteContentHash: runtimeHashSchema.nullable(),
    appliedContentHash: runtimeHashSchema.nullable(),
    runtimeVersion: z.string().min(1),
    pageIds: z.record(runtimeIdSchema, z.number().int().positive()),
    mediaBindings: z.record(z.string().uuid(), runtimeMediaBindingSchema),
    rollback: runtimeRollbackSchema,
    verification: runtimeVerificationSchema.nullable(),
    submittedAt: z.string().datetime({ offset: true }),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    completedAt: z.string().datetime({ offset: true }).nullable(),
    idempotentReplay: z.boolean(),
    failure: runtimeFailureSchema.nullable(),
  })
  .strict()
  .superRefine((deployment, context) => {
    if (
      deployment.status === 'succeeded' &&
      (deployment.phase !== 'complete' ||
        deployment.appliedContentHash !== deployment.artifactContentHash ||
        deployment.completedAt === null ||
        deployment.verification?.verified !== true ||
        deployment.failure !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Succeeded deployment results require the exact applied artifact hash and successful verification',
      })
    }
    if (deployment.status === 'failed' && deployment.failure === null) {
      context.addIssue({
        code: 'custom',
        message: 'Failed deployment results require a precise failure',
      })
    }
  })

export const runtimeStateSchema = z
  .object({
    contractVersion: runtimeContractVersionSchema,
    runtimeVersion: z.string().min(1),
    siteId: runtimeIdSchema,
    artifactId: runtimeArtifactIdSchema.nullable(),
    artifactContentHash: runtimeHashSchema.nullable(),
    assetManifestHash: runtimeHashSchema.nullable(),
    operationHash: runtimeHashSchema.nullable(),
    transactionId: z.string().uuid().nullable(),
    pageIds: z.record(runtimeIdSchema, z.number().int().positive()),
    mediaBindings: z.record(z.string().uuid(), runtimeMediaBindingSchema),
    updatedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()

export type RuntimeFailure = z.infer<typeof runtimeFailureSchema>
export type RuntimeHealth = z.infer<typeof runtimeHealthSchema>
export type RuntimeCapabilities = z.infer<typeof runtimeCapabilitiesSchema>
export type RuntimeState = z.infer<typeof runtimeStateSchema>
export type ImmutableRuntimeAsset = z.infer<typeof immutableRuntimeAssetSchema>
export type AssetPreparationRequest = z.infer<
  typeof assetPreparationRequestSchema
>
export type AssetPreparationResult = z.infer<typeof assetPreparationResultSchema>
export type CompiledMutationPlan = z.infer<typeof compiledMutationPlanSchema>
export type DeploymentSubmission = z.infer<typeof deploymentSubmissionSchema>
export type DeploymentStatus = z.infer<typeof deploymentStatusSchema>

export function hashRuntimeValue(value: unknown): string {
  return hashSiteForgeContent(value)
}

export function deriveAssetManifestHash(
  assets: readonly ImmutableRuntimeAsset[]
): string {
  const identities = assets
    .map(asset => {
      const parsed = immutableRuntimeAssetSchema.parse(asset)
      return immutableRuntimeAssetIdentitySchema.parse({
        assetId: parsed.assetId,
        byteHash: parsed.byteHash,
        bytes: parsed.bytes,
        mimeType: parsed.mimeType,
        filename: parsed.filename,
        role: parsed.role,
        altText: parsed.altText,
        caption: parsed.caption,
      })
    })
    .sort((left, right) => left.assetId.localeCompare(right.assetId))
  return hashRuntimeValue(identities)
}

export function deriveRuntimeOperationHash(
  plan: z.input<typeof compiledMutationPlanSchema>
): string {
  return hashRuntimeValue(compiledMutationPlanSchema.parse(plan))
}

export function deriveRuntimeIdempotencyKey(
  scope: 'asset_preparation' | 'deployment',
  input: {
    siteId: string
    artifactId: string
    artifactContentHash: string
    expectedRemoteContentHash?: string | null
    payloadHash: string
  }
): string {
  return createHash('sha256')
    .update(
      canonicalizeSiteForgeContent({
        contractVersion: SITEFORGE_RUNTIME_CONTRACT_VERSION,
        scope,
        siteId: runtimeIdSchema.parse(input.siteId),
        artifactId: runtimeArtifactIdSchema.parse(input.artifactId),
        artifactContentHash: runtimeHashSchema.parse(
          input.artifactContentHash
        ),
        expectedRemoteContentHash:
          input.expectedRemoteContentHash === null ||
          input.expectedRemoteContentHash === undefined
            ? null
            : runtimeHashSchema.parse(input.expectedRemoteContentHash),
        payloadHash: runtimeHashSchema.parse(input.payloadHash),
      })
    )
    .digest('hex')
}

export function freezeRuntimeValue<T>(value: T): Readonly<T> {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeRuntimeValue(child)
  }
  return Object.freeze(value)
}

function addAssetIssues(
  assets: readonly ImmutableRuntimeAsset[],
  context: z.RefinementCtx
): void {
  const ids = new Set<string>()
  assets.forEach((candidate, index) => {
    const asset = immutableRuntimeAssetSchema.parse(candidate)
    if (ids.has(asset.assetId)) {
      context.addIssue({
        code: 'custom',
        path: ['assets', index, 'assetId'],
        message: 'Each immutable assetId may appear only once',
      })
    }
    ids.add(asset.assetId)
  })
}

function isRuntimeJsonLd(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object'
  } catch {
    return false
  }
}
