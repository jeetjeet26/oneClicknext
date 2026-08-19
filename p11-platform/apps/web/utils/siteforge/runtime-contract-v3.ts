import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  canonicalizeSiteForgeContent,
  hashSiteForgeContent,
} from '@/utils/siteforge/content-hash'
import {
  acfBlockTypeSchema,
  isSiteForgeBlockVariant,
} from '@/types/siteforge'

export const SITEFORGE_RUNTIME_V3_CONTRACT_VERSION = 3 as const
export const SITEFORGE_RUNTIME_V3_NAMESPACE = 'siteforge/v3' as const

export const runtimeV3ContractVersionSchema = z.literal(
  SITEFORGE_RUNTIME_V3_CONTRACT_VERSION
)
export const runtimeV3HashSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const runtimeV3IdSchema = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
export const runtimeV3ArtifactIdSchema = z.string().uuid()
export const runtimeV3BlockNameSchema = z.union([
  acfBlockTypeSchema,
  z.literal('acf/governed-component'),
])
export const runtimeV3ResourceKindSchema = z.enum([
  'page',
  'section',
  'global_component',
  'chrome',
  'form',
  'redirect',
  'responsive_rule',
  'accessibility_annotation',
  'seo',
  'legal',
  'analytics',
  'integration',
  'asset',
])

const semanticVersionSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/)
const rootRelativePathSchema = z
  .string()
  .regex(
    /^\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%-]+\/?)*$/,
    'Expected a root-relative path without query or fragment'
  )
const httpsUrlSchema = z
  .string()
  .url()
  .refine(value => /^https:\/\//i.test(value), {
    message: 'Runtime v3 public URLs must use HTTPS',
  })

export const runtimeV3ManifestFileSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .max(500)
      .refine(
        value =>
          !value.startsWith('/') &&
          !value.includes('\\') &&
          !value.split('/').includes('..'),
        'Manifest paths must be normalized package-relative paths'
      ),
    byteSha256: runtimeV3HashSchema,
    bytes: z.number().int().nonnegative(),
    mode: z.enum(['file', 'executable']),
  })
  .strict()

export const runtimeV3PackageManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    contractVersion: runtimeV3ContractVersionSchema,
    packageName: runtimeV3IdSchema,
    packageVersion: semanticVersionSchema,
    files: z.array(runtimeV3ManifestFileSchema).min(1).max(10_000),
  })
  .strict()
  .superRefine((manifest, context) => {
    addUniqueIssues(
      manifest.files,
      file => file.path,
      context,
      ['files'],
      'Manifest file paths'
    )
  })

export const runtimeV3PackageIdentitySchema = z
  .object({
    packageId: runtimeV3IdSchema,
    packageType: z.enum([
      'runtime_plugin',
      'base_theme',
      'theme_overlay',
      'extension',
    ]),
    archiveSha256: runtimeV3HashSchema,
    archiveBytes: z.number().int().positive(),
    manifestSha256: runtimeV3HashSchema,
    manifest: runtimeV3PackageManifestSchema,
  })
  .strict()
  .superRefine((identity, context) => {
    if (deriveRuntimeV3PackageManifestHash(identity.manifest) !== identity.manifestSha256) {
      context.addIssue({
        code: 'custom',
        path: ['manifestSha256'],
        message: 'Package manifest digest does not match the exact manifest',
      })
    }
  })

const runtimeV3ResourceIdentityFields = {
  resourceId: runtimeV3IdSchema,
  contentHash: runtimeV3HashSchema,
}

export const runtimeV3AssetSchema = z
  .object({
    ...runtimeV3ResourceIdentityFields,
    assetId: z.string().uuid(),
    byteSha256: runtimeV3HashSchema,
    bytes: z.number().int().positive(),
    mimeType: z.string().min(1).max(150),
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
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    rights: z
      .object({
        status: z.enum(['owned', 'licensed', 'generated']),
        evidenceHash: runtimeV3HashSchema,
      })
      .strict(),
  })
  .strict()

export const runtimeV3AssetSourceSchema = z
  .object({
    assetId: z.string().uuid(),
    sourceUrl: httpsUrlSchema,
    byteSha256: runtimeV3HashSchema,
  })
  .strict()

export const runtimeV3SectionSchema = z
  .object({
    ...runtimeV3ResourceIdentityFields,
    pageId: runtimeV3IdSchema,
    sectionType: runtimeV3IdSchema,
    blockName: runtimeV3BlockNameSchema,
    order: z.number().int().nonnegative(),
    variant: z.string().min(1).max(100).nullable(),
    anchor: runtimeV3IdSchema.nullable(),
    cssClasses: z.array(runtimeV3IdSchema).max(50),
    data: z.record(z.string(), z.unknown()),
    assetIds: z.array(z.string().uuid()).max(100),
    formId: runtimeV3IdSchema.nullable(),
    integrationIds: z.array(runtimeV3IdSchema).max(50),
  })
  .strict()
  .superRefine((section, context) => {
    if (
      section.variant !== null &&
      !(
        (section.blockName === 'acf/governed-component' &&
          section.variant === 'governed') ||
        (section.blockName !== 'acf/governed-component' &&
          isSiteForgeBlockVariant(section.blockName, section.variant))
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['variant'],
        message: `Unsupported ${section.blockName} variant ${section.variant}`,
      })
    }
  })

export const runtimeV3PageSchema = z
  .object({
    ...runtimeV3ResourceIdentityFields,
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().min(1).max(500),
    purpose: z.string().max(10_000),
    status: z.enum(['publish', 'draft', 'private']),
    template: z.string().max(255),
    menuOrder: z.number().int().nonnegative(),
    sectionIds: z.array(runtimeV3IdSchema).max(500),
    seoId: runtimeV3IdSchema.nullable(),
  })
  .strict()

export const runtimeV3GlobalComponentSchema = z
  .object({
    ...runtimeV3ResourceIdentityFields,
    componentType: z.enum([
      'header',
      'footer',
      'navigation',
      'announcement',
      'modal',
      'consent',
      'utility',
    ]),
    data: z.record(z.string(), z.unknown()),
    assetIds: z.array(z.string().uuid()).max(100),
    integrationIds: z.array(runtimeV3IdSchema).max(50),
  })
  .strict()

export const runtimeV3ChromeSchema = z
  .object({
    ...runtimeV3ResourceIdentityFields,
    headerComponentId: runtimeV3IdSchema,
    footerComponentId: runtimeV3IdSchema,
    componentIds: z.array(runtimeV3IdSchema).max(100),
  })
  .strict()

export const runtimeV3FormSchema = z
  .object({
    ...runtimeV3ResourceIdentityFields,
    formType: z.enum([
      'contact',
      'lead',
      'tour',
      'application',
      'newsletter',
      'custom',
    ]),
    fields: z
      .array(
        z
          .object({
            fieldId: runtimeV3IdSchema,
            type: z.enum([
              'text',
              'email',
              'tel',
              'number',
              'date',
              'time',
              'select',
              'checkbox',
              'radio',
              'textarea',
              'hidden',
            ]),
            label: z.string().max(500),
            required: z.boolean(),
            options: z.array(z.string().max(500)).max(200),
            autocomplete: z.string().max(100).nullable(),
          })
          .strict()
      )
      .min(1)
      .max(200),
    submitLabel: z.string().min(1).max(200),
    integrationId: runtimeV3IdSchema,
    consentLegalResourceId: runtimeV3IdSchema.nullable(),
    successBehavior: z
      .object({
        mode: z.enum(['message', 'redirect']),
        message: z.string().max(5_000).nullable(),
        redirectPath: rootRelativePathSchema.nullable(),
      })
      .strict(),
  })
  .strict()

export const runtimeV3RedirectSchema = z
  .object({
    ...runtimeV3ResourceIdentityFields,
    sourcePath: rootRelativePathSchema,
    destination: z.union([rootRelativePathSchema, httpsUrlSchema]),
    statusCode: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]),
    preserveQuery: z.boolean(),
  })
  .strict()

const runtimeV3ResourceTargetSchema = z
  .object({
    resourceKind: runtimeV3ResourceKindSchema,
    resourceId: runtimeV3IdSchema,
  })
  .strict()

export const runtimeV3ResponsiveRuleSchema = z
  .object({
    ...runtimeV3ResourceIdentityFields,
    target: runtimeV3ResourceTargetSchema,
    minWidthPx: z.number().int().nonnegative().nullable(),
    maxWidthPx: z.number().int().positive().nullable(),
    declarations: z.record(z.string(), z.string().max(2_000)),
  })
  .strict()
  .refine(
    rule =>
      rule.minWidthPx === null ||
      rule.maxWidthPx === null ||
      rule.minWidthPx <= rule.maxWidthPx,
    { message: 'Responsive rule minimum width cannot exceed maximum width' }
  )

export const runtimeV3AccessibilityAnnotationSchema = z
  .object({
    ...runtimeV3ResourceIdentityFields,
    target: runtimeV3ResourceTargetSchema,
    standard: z.literal('WCAG-2.2-AA'),
    role: z.string().max(100).nullable(),
    accessibleName: z.string().max(1_000).nullable(),
    description: z.string().max(2_000).nullable(),
    keyboardBehavior: z.array(z.string().min(1).max(500)).max(100),
    headingLevel: z.number().int().min(1).max(6).nullable(),
    liveRegion: z.enum(['off', 'polite', 'assertive']).nullable(),
  })
  .strict()

export const runtimeV3SeoSchema = z
  .object({
    ...runtimeV3ResourceIdentityFields,
    scope: z.enum(['site', 'page']),
    pageId: runtimeV3IdSchema.nullable(),
    title: z.string().min(1).max(500),
    description: z.string().max(10_000),
    canonicalPath: rootRelativePathSchema,
    robots: z
      .object({
        index: z.boolean(),
        follow: z.boolean(),
      })
      .strict(),
    openGraph: z
      .object({
        title: z.string().max(500),
        description: z.string().max(10_000),
        imageAssetId: z.string().uuid().nullable(),
      })
      .strict(),
    structuredData: z.array(z.record(z.string(), z.unknown())).max(100),
  })
  .strict()
  .refine(
    seo =>
      (seo.scope === 'page' && seo.pageId !== null) ||
      (seo.scope === 'site' && seo.pageId === null),
    { message: 'SEO page scope and pageId must agree' }
  )

export const runtimeV3LegalSchema = z
  .object({
    ...runtimeV3ResourceIdentityFields,
    policyType: z.enum([
      'privacy',
      'terms',
      'accessibility',
      'fair_housing',
      'pricing_disclaimer',
      'analytics_consent',
      'communications_consent',
    ]),
    policyVersion: z.number().int().positive(),
    approvedAt: z.string().datetime({ offset: true }),
    effectiveAt: z.string().datetime({ offset: true }),
    body: z.string().min(1).max(250_000),
    approvalEvidenceHash: runtimeV3HashSchema,
  })
  .strict()

export const runtimeV3AnalyticsSchema = z
  .object({
    ...runtimeV3ResourceIdentityFields,
    consentMode: z.enum(['required', 'optional', 'disabled']),
    integrationIds: z.array(runtimeV3IdSchema).max(50),
    events: z
      .array(
        z
          .object({
            eventId: runtimeV3IdSchema,
            name: runtimeV3IdSchema,
            trigger: z.string().min(1).max(1_000),
            parameters: z.record(z.string(), z.string().max(1_000)),
          })
          .strict()
      )
      .max(500),
  })
  .strict()

export const runtimeV3IntegrationSchema = z
  .object({
    ...runtimeV3ResourceIdentityFields,
    provider: runtimeV3IdSchema,
    scopes: z
      .array(
        z.enum([
          'site',
          'page',
          'form_submission',
          'analytics',
          'public_runtime',
        ])
      )
      .min(1),
    pageIds: z.array(runtimeV3IdSchema).max(500),
    formIds: z.array(runtimeV3IdSchema).max(500),
    allowedDestinations: z.array(httpsUrlSchema).max(100),
    configuration: z.record(z.string(), z.unknown()),
    secretReference: runtimeV3IdSchema.nullable(),
  })
  .strict()

export const runtimeV3RemovalTombstoneSchema = z
  .object({
    resourceKind: runtimeV3ResourceKindSchema,
    resourceId: runtimeV3IdSchema,
    priorContentHash: runtimeV3HashSchema,
    removedAt: z.string().datetime({ offset: true }),
    reason: z.string().min(1).max(2_000),
  })
  .strict()

export const runtimeV3ResourceGraphSchema = z
  .object({
    graphVersion: z.literal(1),
    homepagePageId: runtimeV3IdSchema,
    pages: z.array(runtimeV3PageSchema).min(1).max(500),
    sections: z.array(runtimeV3SectionSchema).max(5_000),
    globalComponents: z.array(runtimeV3GlobalComponentSchema).min(2).max(500),
    chrome: runtimeV3ChromeSchema,
    forms: z.array(runtimeV3FormSchema).max(500),
    redirects: z.array(runtimeV3RedirectSchema).max(2_000),
    responsiveRules: z.array(runtimeV3ResponsiveRuleSchema).max(5_000),
    accessibilityAnnotations: z
      .array(runtimeV3AccessibilityAnnotationSchema)
      .max(10_000),
    seo: z.array(runtimeV3SeoSchema).min(1).max(1_000),
    legal: z.array(runtimeV3LegalSchema).min(1).max(100),
    analytics: runtimeV3AnalyticsSchema,
    integrations: z.array(runtimeV3IntegrationSchema).max(500),
    assets: z.array(runtimeV3AssetSchema).max(2_000),
    removals: z.array(runtimeV3RemovalTombstoneSchema).max(5_000),
  })
  .strict()
  .superRefine(addResourceGraphIssues)

export const runtimeV3OperationSchema = z
  .object({
    operationId: runtimeV3IdSchema,
    sequence: z.number().int().nonnegative(),
    kind: z.enum(['create', 'update', 'delete', 'bind', 'unbind', 'configure']),
    resourceKind: runtimeV3ResourceKindSchema,
    resourceId: runtimeV3IdSchema,
    resourceHash: runtimeV3HashSchema.nullable(),
    payloadHash: runtimeV3HashSchema,
    dependsOn: z.array(runtimeV3IdSchema).max(500),
  })
  .strict()
  .refine(
    operation =>
      (operation.kind === 'delete' && operation.resourceHash === null) ||
      (operation.kind !== 'delete' && operation.resourceHash !== null),
    { message: 'Delete operations alone require a null resource hash' }
  )

export const runtimeV3OverlayIdentitySchema = z
  .object({
    overlayId: runtimeV3IdSchema,
    contentHash: runtimeV3HashSchema,
    themeSlug: z
      .string()
      .regex(/^oneclick-siteforge-overlay-[a-f0-9]{12}$/),
    appliesToBaseThemeArchiveSha256: runtimeV3HashSchema,
    package: runtimeV3PackageIdentitySchema,
  })
  .strict()
  .refine(value => value.package.packageType === 'theme_overlay', {
    message: 'Overlay packages must have packageType theme_overlay',
    path: ['package', 'packageType'],
  })

export const runtimeV3ExtensionIdentitySchema = z
  .object({
    extensionId: runtimeV3IdSchema,
    contentHash: runtimeV3HashSchema,
    configurationHash: runtimeV3HashSchema,
    scopes: z.array(runtimeV3ResourceTargetSchema).max(1_000),
    permissions: z.array(runtimeV3IdSchema).max(200),
    package: runtimeV3PackageIdentitySchema,
  })
  .strict()
  .refine(value => value.package.packageType === 'extension', {
    message: 'Extension packages must have packageType extension',
    path: ['package', 'packageType'],
  })

export const runtimeV3ReleaseIdentitySchema = z
  .object({
    siteId: runtimeV3IdSchema,
    artifactId: runtimeV3ArtifactIdSchema,
    artifactContentHash: runtimeV3HashSchema,
    resourceGraphHash: runtimeV3HashSchema,
    assetManifestHash: runtimeV3HashSchema,
    operationSetHash: runtimeV3HashSchema,
    baseTheme: runtimeV3PackageIdentitySchema,
    runtimePackage: runtimeV3PackageIdentitySchema,
    overlays: z.array(runtimeV3OverlayIdentitySchema).max(20),
    extensions: z.array(runtimeV3ExtensionIdentitySchema).max(100),
  })
  .strict()
  .superRefine((identity, context) => {
    if (identity.baseTheme.packageType !== 'base_theme') {
      context.addIssue({
        code: 'custom',
        path: ['baseTheme', 'packageType'],
        message: 'Base theme identity must have packageType base_theme',
      })
    }
    if (identity.runtimePackage.packageType !== 'runtime_plugin') {
      context.addIssue({
        code: 'custom',
        path: ['runtimePackage', 'packageType'],
        message: 'Runtime identity must have packageType runtime_plugin',
      })
    }
    addUniqueIssues(
      identity.overlays,
      item => item.overlayId,
      context,
      ['overlays'],
      'Overlay ids'
    )
    addUniqueIssues(
      identity.extensions,
      item => item.extensionId,
      context,
      ['extensions'],
      'Extension ids'
    )
    addUniqueIssues(
      [
        identity.baseTheme,
        identity.runtimePackage,
        ...identity.overlays.map(item => item.package),
        ...identity.extensions.map(item => item.package),
      ],
      item => item.packageId,
      context,
      [],
      'Package ids'
    )
  })

export const runtimeV3ProtectionSchema = z
  .object({
    mode: z.enum(['noindex', 'password_noindex', 'public']),
    passwordReference: runtimeV3IdSchema.nullable(),
  })
  .strict()
  .refine(
    value =>
      (value.mode === 'password_noindex' && value.passwordReference !== null) ||
      (value.mode !== 'password_noindex' && value.passwordReference === null),
    { message: 'Only password-protected targets carry a password reference' }
  )

export const runtimeV3PublicRuntimeSchema = z
  .object({
    enabled: z.boolean(),
    apiBaseUrl: httpsUrlSchema,
    websiteId: z.string().uuid(),
    keyReference: runtimeV3IdSchema.nullable(),
    conversionEndpoint: httpsUrlSchema,
    conversionKey: z.string().min(1).max(512).optional(),
    telemetryEndpoint: httpsUrlSchema,
    allowedOrigins: z.array(httpsUrlSchema).max(100),
  })
  .strict()
  .refine(value => !value.enabled || value.keyReference !== null, {
    message: 'Enabled public runtime requires a key reference',
    path: ['keyReference'],
  })

export const runtimeV3TargetSchema = z
  .object({
    targetId: runtimeV3IdSchema,
    environment: z.enum(['canonical_preview', 'staging', 'production']),
    siteUrl: httpsUrlSchema,
    protection: runtimeV3ProtectionSchema,
    publicRuntime: runtimeV3PublicRuntimeSchema,
  })
  .strict()

export const immutableSiteForgeRuntimeV3ReleaseSchema = z
  .object({
    contractVersion: runtimeV3ContractVersionSchema,
    identity: runtimeV3ReleaseIdentitySchema,
    resourceGraph: runtimeV3ResourceGraphSchema,
    operations: z.array(runtimeV3OperationSchema).min(1).max(20_000),
    assetSources: z.array(runtimeV3AssetSourceSchema).max(2_000),
    target: runtimeV3TargetSchema,
  })
  .strict()
  .superRefine(addReleaseIssues)

export const runtimeV3FailureCodeSchema = z.enum([
  'unauthorized',
  'forbidden',
  'unsupported_contract',
  'capability_mismatch',
  'stale_remote_state',
  'idempotency_conflict',
  'invalid_artifact',
  'invalid_resource_graph',
  'invalid_asset',
  'asset_hash_mismatch',
  'invalid_package',
  'package_hash_mismatch',
  'manifest_hash_mismatch',
  'invalid_operation_set',
  'operation_failed',
  'deployment_not_found',
  'rollback_failed',
  'runtime_unavailable',
  'rate_limited',
  'internal_error',
  'invalid_response',
])

export const runtimeV3FailureSchema = z
  .object({
    code: runtimeV3FailureCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
    stage: z
      .enum([
        'authentication',
        'health',
        'capabilities',
        'state',
        'package_verification',
        'asset_preparation',
        'preflight',
        'transaction',
        'verification',
        'v2_projection',
        'rollback',
      ])
      .optional(),
    operationSetHash: runtimeV3HashSchema.optional(),
    expectedRemoteContentHash: runtimeV3HashSchema.nullable().optional(),
    actualRemoteContentHash: runtimeV3HashSchema.nullable().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const runtimeV3ErrorResponseSchema = z
  .object({
    contractVersion: runtimeV3ContractVersionSchema.optional(),
    error: runtimeV3FailureSchema,
    requestId: z.string().min(1).optional(),
  })
  .strict()

export const runtimeV3HealthSchema = z
  .object({
    contractVersion: runtimeV3ContractVersionSchema,
    runtimeVersion: semanticVersionSchema,
    namespace: z.literal(SITEFORGE_RUNTIME_V3_NAMESPACE),
    status: z.enum(['ok', 'degraded', 'unavailable']),
    checkedAt: z.string().datetime({ offset: true }),
    installedRuntime: runtimeV3PackageIdentitySchema,
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
  .refine(value => value.installedRuntime.packageType === 'runtime_plugin', {
    message: 'Health runtime package must identify a runtime plugin',
    path: ['installedRuntime', 'packageType'],
  })

export const runtimeV3CapabilitiesSchema = z
  .object({
    contractVersion: runtimeV3ContractVersionSchema,
    runtimeVersion: semanticVersionSchema,
    provider: z.literal('wordpress'),
    authentication: z.literal('wordpress_application_password'),
    features: z
      .object({
        completeResourceGraph: z.literal(true),
        exactPackageIdentity: z.literal(true),
        immutableAssetPreparation: z.literal(true),
        optimisticConcurrency: z.literal(true),
        idempotentTransactions: z.literal(true),
        transactionalRollback: z.literal(true),
        v2RollbackProjection: z.literal(true),
        scopedIntegrations: z.literal(true),
        targetProtection: z.literal(true),
        publicRuntime: z.literal(true),
      })
      .strict(),
    limits: z
      .object({
        maxAssetsPerPreparation: z.number().int().positive(),
        maxAssetBytes: z.number().int().positive(),
        maxResourcesPerDeployment: z.number().int().positive(),
        maxOperationsPerDeployment: z.number().int().positive(),
        acceptedAssetMimeTypes: z.array(z.string().min(1)),
      })
      .strict(),
  })
  .strict()

export const runtimeV3AssetPreparationRequestSchema = z
  .object({
    contractVersion: runtimeV3ContractVersionSchema,
    identity: runtimeV3ReleaseIdentitySchema,
    idempotencyKey: runtimeV3HashSchema,
    assets: z
      .array(
        z
          .object({
            asset: runtimeV3AssetSchema,
            source: runtimeV3AssetSourceSchema,
          })
          .strict()
      )
      .max(2_000),
  })
  .strict()
  .superRefine((request, context) => {
    request.assets.forEach((item, index) => {
      if (
        item.asset.assetId !== item.source.assetId ||
        item.asset.byteSha256 !== item.source.byteSha256
      ) {
        context.addIssue({
          code: 'custom',
          path: ['assets', index, 'source'],
          message: 'Asset source must match the exact immutable asset identity',
        })
      }
    })
    if (
      deriveRuntimeV3AssetManifestHash(request.assets.map(item => item.asset)) !==
      request.identity.assetManifestHash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message:
          'Asset preparation must contain the complete exact release asset manifest',
      })
    }
    const expected = deriveRuntimeV3IdempotencyKey('asset_preparation', {
      identity: request.identity,
      expectedRemoteContentHash: null,
    })
    if (request.idempotencyKey !== expected) {
      context.addIssue({
        code: 'custom',
        path: ['idempotencyKey'],
        message: 'Asset preparation idempotency key does not match release identity',
      })
    }
  })

export const runtimeV3PreparedAssetSchema = z
  .object({
    assetId: z.string().uuid(),
    byteSha256: runtimeV3HashSchema,
    attachmentId: z.number().int().positive(),
    url: httpsUrlSchema,
    mimeType: z.string().min(1),
    disposition: z.enum(['created', 'reused']),
  })
  .strict()

export const runtimeV3AssetPreparationResultSchema = z
  .object({
    contractVersion: runtimeV3ContractVersionSchema,
    preparationId: runtimeV3IdSchema,
    identity: runtimeV3ReleaseIdentitySchema,
    idempotencyKey: runtimeV3HashSchema,
    assets: z.array(runtimeV3PreparedAssetSchema),
    preparedAt: z.string().datetime({ offset: true }),
  })
  .strict()

export const runtimeV3DeploymentSubmissionSchema = z
  .object({
    contractVersion: runtimeV3ContractVersionSchema,
    release: immutableSiteForgeRuntimeV3ReleaseSchema,
    assetPreparationId: runtimeV3IdSchema,
    expectedRemoteContentHash: runtimeV3HashSchema.nullable(),
    idempotencyKey: runtimeV3HashSchema,
  })
  .strict()
  .superRefine((submission, context) => {
    const expected = deriveRuntimeV3IdempotencyKey('deployment', {
      identity: submission.release.identity,
      expectedRemoteContentHash: submission.expectedRemoteContentHash,
    })
    if (submission.idempotencyKey !== expected) {
      context.addIssue({
        code: 'custom',
        path: ['idempotencyKey'],
        message: 'Deployment idempotency key does not match exact release identity',
      })
    }
  })

export const runtimeV3RollbackRequestSchema = z
  .object({
    contractVersion: runtimeV3ContractVersionSchema,
    transactionId: z.string().uuid(),
    siteId: runtimeV3IdSchema,
    expectedCurrentContentHash: runtimeV3HashSchema,
    restoreArtifactContentHash: runtimeV3HashSchema,
    restoreResourceGraphHash: runtimeV3HashSchema,
    idempotencyKey: runtimeV3HashSchema,
  })
  .strict()
  .superRefine((request, context) => {
    const expected = createHash('sha256')
      .update(
        canonicalizeSiteForgeContent({
          contractVersion: SITEFORGE_RUNTIME_V3_CONTRACT_VERSION,
          scope: 'rollback',
          transactionId: request.transactionId,
          siteId: request.siteId,
          expectedCurrentContentHash: request.expectedCurrentContentHash,
          restoreArtifactContentHash: request.restoreArtifactContentHash,
          restoreResourceGraphHash: request.restoreResourceGraphHash,
        })
      )
      .digest('hex')
    if (request.idempotencyKey !== expected) {
      context.addIssue({
        code: 'custom',
        path: ['idempotencyKey'],
        message: 'Rollback idempotency key does not match exact restore identity',
      })
    }
  })

export const runtimeV3V2ProjectionSchema = z
  .object({
    contractVersion: z.literal(2),
    siteId: runtimeV3IdSchema,
    artifactId: runtimeV3ArtifactIdSchema,
    artifactContentHash: runtimeV3HashSchema,
    assetManifestHash: runtimeV3HashSchema,
    operationHash: runtimeV3HashSchema,
    stateHash: runtimeV3HashSchema,
  })
  .strict()

export const runtimeV3V2ProjectionResponseSchema = z
  .object({
    contractVersion: runtimeV3ContractVersionSchema,
    projection: runtimeV3V2ProjectionSchema.nullable(),
  })
  .strict()

export const runtimeV3RollbackSchema = z
  .object({
    attempted: z.boolean(),
    succeeded: z.boolean().nullable(),
    restoredArtifactContentHash: runtimeV3HashSchema.nullable(),
    restoredResourceGraphHash: runtimeV3HashSchema.nullable(),
    failure: runtimeV3FailureSchema.nullable(),
  })
  .strict()

export const runtimeV3VerificationSchema = z
  .object({
    verified: z.boolean(),
    resourceGraphHash: runtimeV3HashSchema.nullable(),
    packageManifestSha256: runtimeV3HashSchema.nullable(),
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

export const runtimeV3DeploymentStatusSchema = z
  .object({
    contractVersion: runtimeV3ContractVersionSchema,
    transactionId: z.string().uuid(),
    status: z.enum(['running', 'succeeded', 'failed']),
    phase: z.enum([
      'preflight',
      'package_verification',
      'assets',
      'transaction',
      'verification',
      'v2_projection',
      'rollback',
      'complete',
    ]),
    identity: runtimeV3ReleaseIdentitySchema,
    idempotencyKey: runtimeV3HashSchema,
    expectedRemoteContentHash: runtimeV3HashSchema.nullable(),
    previousRemoteContentHash: runtimeV3HashSchema.nullable(),
    appliedContentHash: runtimeV3HashSchema.nullable(),
    runtimeVersion: semanticVersionSchema,
    resourceIds: z.record(runtimeV3IdSchema, z.number().int().positive()),
    mediaBindings: z.record(z.string().uuid(), runtimeV3PreparedAssetSchema),
    v2Projection: runtimeV3V2ProjectionSchema.nullable(),
    rollback: runtimeV3RollbackSchema,
    verification: runtimeV3VerificationSchema.nullable(),
    submittedAt: z.string().datetime({ offset: true }),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    completedAt: z.string().datetime({ offset: true }).nullable(),
    idempotentReplay: z.boolean(),
    failure: runtimeV3FailureSchema.nullable(),
  })
  .strict()
  .superRefine((deployment, context) => {
    if (
      deployment.status === 'succeeded' &&
      (deployment.phase !== 'complete' ||
        deployment.appliedContentHash !==
          deployment.identity.artifactContentHash ||
        deployment.completedAt === null ||
        deployment.verification?.verified !== true ||
        deployment.verification.resourceGraphHash !==
          deployment.identity.resourceGraphHash ||
        deployment.verification.packageManifestSha256 !==
          deployment.identity.runtimePackage.manifestSha256 ||
        deployment.v2Projection === null ||
        deployment.failure !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Succeeded v3 deployments require exact artifact, graph, package, v2 projection, and verification identities',
      })
    }
    if (deployment.status === 'failed' && deployment.failure === null) {
      context.addIssue({
        code: 'custom',
        message: 'Failed v3 deployments require a precise failure',
      })
    }
  })

export const runtimeV3StateSchema = z
  .object({
    contractVersion: runtimeV3ContractVersionSchema,
    runtimeVersion: semanticVersionSchema,
    siteId: runtimeV3IdSchema,
    identity: runtimeV3ReleaseIdentitySchema.nullable(),
    transactionId: z.string().uuid().nullable(),
    target: runtimeV3TargetSchema.nullable(),
    resourceHashes: z.record(runtimeV3IdSchema, runtimeV3HashSchema),
    mediaBindings: z.record(z.string().uuid(), runtimeV3PreparedAssetSchema),
    v2Projection: runtimeV3V2ProjectionSchema.nullable(),
    updatedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()

export type RuntimeV3PackageIdentity = z.infer<
  typeof runtimeV3PackageIdentitySchema
>
export type RuntimeV3Asset = z.infer<typeof runtimeV3AssetSchema>
export type RuntimeV3AssetSource = z.infer<typeof runtimeV3AssetSourceSchema>
export type RuntimeV3ResourceGraph = z.infer<
  typeof runtimeV3ResourceGraphSchema
>
export type RuntimeV3Operation = z.infer<typeof runtimeV3OperationSchema>
export type RuntimeV3ReleaseIdentity = z.infer<
  typeof runtimeV3ReleaseIdentitySchema
>
export type ImmutableSiteForgeRuntimeV3Release = z.infer<
  typeof immutableSiteForgeRuntimeV3ReleaseSchema
>
export type RuntimeV3Failure = z.infer<typeof runtimeV3FailureSchema>
export type RuntimeV3Health = z.infer<typeof runtimeV3HealthSchema>
export type RuntimeV3Capabilities = z.infer<typeof runtimeV3CapabilitiesSchema>
export type RuntimeV3State = z.infer<typeof runtimeV3StateSchema>
export type RuntimeV3AssetPreparationRequest = z.infer<
  typeof runtimeV3AssetPreparationRequestSchema
>
export type RuntimeV3AssetPreparationResult = z.infer<
  typeof runtimeV3AssetPreparationResultSchema
>
export type RuntimeV3DeploymentSubmission = z.infer<
  typeof runtimeV3DeploymentSubmissionSchema
>
export type RuntimeV3RollbackRequest = z.infer<
  typeof runtimeV3RollbackRequestSchema
>
export type RuntimeV3V2Projection = z.infer<typeof runtimeV3V2ProjectionSchema>
export type RuntimeV3V2ProjectionResponse = z.infer<
  typeof runtimeV3V2ProjectionResponseSchema
>
export type RuntimeV3DeploymentStatus = z.infer<
  typeof runtimeV3DeploymentStatusSchema
>

function normalizeRuntimeV3WireHashValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeRuntimeV3WireHashValue)
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    // WordPress REST decodes both `{}` and `[]` to an empty PHP array. Runtime
    // hashes therefore use that wire representation so the sender and receiver
    // cannot disagree after JSON decoding.
    if (!entries.length) return []
    return Object.fromEntries(
      entries.map(([key, item]) => [key, normalizeRuntimeV3WireHashValue(item)])
    )
  }
  return value
}

export function hashRuntimeV3WireContent(value: unknown): string {
  return hashSiteForgeContent(normalizeRuntimeV3WireHashValue(value))
}

export function deriveRuntimeV3PackageManifestHash(
  manifest: z.input<typeof runtimeV3PackageManifestSchema>
): string {
  return hashSiteForgeContent(runtimeV3PackageManifestSchema.parse(manifest))
}

export function deriveRuntimeV3ResourceGraphHash(
  graph: z.input<typeof runtimeV3ResourceGraphSchema>
): string {
  return hashRuntimeV3WireContent(runtimeV3ResourceGraphSchema.parse(graph))
}

export function deriveRuntimeV3AssetManifestHash(
  assets: readonly RuntimeV3Asset[]
): string {
  return hashSiteForgeContent(
    assets
      .map(asset => runtimeV3AssetSchema.parse(asset))
      .sort((left, right) => left.assetId.localeCompare(right.assetId))
  )
}

export function deriveRuntimeV3OperationSetHash(
  operations: readonly RuntimeV3Operation[]
): string {
  return hashSiteForgeContent(
    operations
      .map(operation => runtimeV3OperationSchema.parse(operation))
      .sort((left, right) => left.sequence - right.sequence)
  )
}

export function deriveRuntimeV3IdempotencyKey(
  scope: 'asset_preparation' | 'deployment',
  input: {
    identity: RuntimeV3ReleaseIdentity
    expectedRemoteContentHash: string | null
  }
): string {
  const identity = runtimeV3ReleaseIdentitySchema.parse(input.identity)
  return createHash('sha256')
    .update(
      canonicalizeSiteForgeContent({
        contractVersion: SITEFORGE_RUNTIME_V3_CONTRACT_VERSION,
        scope,
        identity,
        expectedRemoteContentHash:
          input.expectedRemoteContentHash === null
            ? null
            : runtimeV3HashSchema.parse(input.expectedRemoteContentHash),
      })
    )
    .digest('hex')
}

export function deriveRuntimeV3RollbackIdempotencyKey(
  input: Omit<RuntimeV3RollbackRequest, 'contractVersion' | 'idempotencyKey'>
): string {
  return createHash('sha256')
    .update(
      canonicalizeSiteForgeContent({
        contractVersion: SITEFORGE_RUNTIME_V3_CONTRACT_VERSION,
        scope: 'rollback',
        transactionId: input.transactionId,
        siteId: input.siteId,
        expectedCurrentContentHash: input.expectedCurrentContentHash,
        restoreArtifactContentHash: input.restoreArtifactContentHash,
        restoreResourceGraphHash: input.restoreResourceGraphHash,
      })
    )
    .digest('hex')
}

export function freezeRuntimeV3Value<T>(value: T): Readonly<T> {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeRuntimeV3Value(child)
  }
  return Object.freeze(value)
}

function addReleaseIssues(
  release: z.infer<typeof immutableSiteForgeRuntimeV3ReleaseSchema>,
  context: z.RefinementCtx
): void {
  const identity = release.identity
  if (
    hashRuntimeV3WireContent(release.resourceGraph) !== identity.resourceGraphHash
  ) {
    addHashIssue(context, ['identity', 'resourceGraphHash'], 'resource graph')
  }
  if (
    hashSiteForgeContent(
      [...release.resourceGraph.assets].sort((left, right) =>
        left.assetId.localeCompare(right.assetId)
      )
    ) !== identity.assetManifestHash
  ) {
    addHashIssue(context, ['identity', 'assetManifestHash'], 'asset manifest')
  }
  if (
    hashSiteForgeContent(
      [...release.operations].sort((left, right) => left.sequence - right.sequence)
    ) !== identity.operationSetHash
  ) {
    addHashIssue(context, ['identity', 'operationSetHash'], 'operation set')
  }

  const sourceByAsset = new Map(release.assetSources.map(source => [source.assetId, source]))
  release.resourceGraph.assets.forEach((asset, index) => {
    const source = sourceByAsset.get(asset.assetId)
    if (!source || source.byteSha256 !== asset.byteSha256) {
      context.addIssue({
        code: 'custom',
        path: ['assetSources', index],
        message: `Asset ${asset.assetId} requires one exact byte-matched source`,
      })
    }
  })
  if (sourceByAsset.size !== release.resourceGraph.assets.length) {
    context.addIssue({
      code: 'custom',
      path: ['assetSources'],
      message: 'Asset sources must exactly match the resource graph asset set',
    })
  }

  identity.overlays.forEach((overlay, index) => {
    if (
      overlay.appliesToBaseThemeArchiveSha256 !==
      identity.baseTheme.archiveSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['identity', 'overlays', index, 'appliesToBaseThemeArchiveSha256'],
        message: 'Overlay is not bound to the exact base theme archive',
      })
    }
  })

  const resourceEntries = graphResourceEntries(release.resourceGraph)
  const resourceById = new Map(
    resourceEntries.map(entry => [entry.resource.resourceId, entry])
  )
  identity.extensions.forEach((extension, extensionIndex) => {
    extension.scopes.forEach((scope, scopeIndex) => {
      const target = resourceById.get(scope.resourceId)
      if (!target || target.kind !== scope.resourceKind) {
        addReferenceIssue(
          context,
          ['identity', 'extensions', extensionIndex, 'scopes', scopeIndex],
          scope.resourceId
        )
      }
    })
  })

  addUniqueIssues(
    release.operations,
    operation => operation.operationId,
    context,
    ['operations'],
    'Operation ids'
  )
  const operationIds = new Set(release.operations.map(item => item.operationId))
  release.operations.forEach((operation, index) => {
    if (operation.sequence !== index) {
      context.addIssue({
        code: 'custom',
        path: ['operations', index, 'sequence'],
        message: 'Operation sequences must be contiguous and ordered from zero',
      })
    }
    operation.dependsOn.forEach(dependency => {
      if (!operationIds.has(dependency)) {
        context.addIssue({
          code: 'custom',
          path: ['operations', index, 'dependsOn'],
          message: `Operation dependency ${dependency} does not exist`,
        })
      } else {
        const dependencyIndex = release.operations.findIndex(
          candidate => candidate.operationId === dependency
        )
        if (dependencyIndex >= index) {
          context.addIssue({
            code: 'custom',
            path: ['operations', index, 'dependsOn'],
            message:
              'Operation dependencies must reference an earlier operation',
          })
        }
      }
    })
    const target = resourceById.get(operation.resourceId)
    if (operation.kind === 'delete') {
      const tombstone = release.resourceGraph.removals.find(
        item =>
          item.resourceId === operation.resourceId &&
          item.resourceKind === operation.resourceKind
      )
      if (!tombstone) {
        addReferenceIssue(
          context,
          ['operations', index, 'resourceId'],
          operation.resourceId
        )
      }
    } else if (
      !target ||
      target.kind !== operation.resourceKind ||
      target.resource.contentHash !== operation.resourceHash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['operations', index, 'resourceHash'],
        message: 'Operation must bind to the exact desired resource identity',
      })
    }
  })
}

function addResourceGraphIssues(
  graph: z.infer<typeof runtimeV3ResourceGraphSchema>,
  context: z.RefinementCtx
): void {
  const resourceEntries = graphResourceEntries(graph)
  const resourceById = new Map<string, (typeof resourceEntries)[number]>()
  resourceEntries.forEach((entry, index) => {
    if (resourceById.has(entry.resource.resourceId)) {
      context.addIssue({
        code: 'custom',
        path: ['resources', index, 'resourceId'],
        message: `Resource id ${entry.resource.resourceId} must be globally unique`,
      })
    }
    resourceById.set(entry.resource.resourceId, entry)
  })
  const pageIds = new Set(graph.pages.map(page => page.resourceId))
  const sectionIds = new Set(graph.sections.map(section => section.resourceId))
  const componentIds = new Set(
    graph.globalComponents.map(component => component.resourceId)
  )
  const formIds = new Set(graph.forms.map(form => form.resourceId))
  const integrationIds = new Set(
    graph.integrations.map(integration => integration.resourceId)
  )
  const legalIds = new Set(graph.legal.map(legal => legal.resourceId))
  const seoIds = new Set(graph.seo.map(seo => seo.resourceId))
  const assetIds = new Set(graph.assets.map(asset => asset.assetId))

  if (!pageIds.has(graph.homepagePageId)) {
    context.addIssue({
      code: 'custom',
      path: ['homepagePageId'],
      message: 'Homepage must reference an exact page resource',
    })
  }
  graph.pages.forEach((page, index) => {
    page.sectionIds.forEach(sectionId => {
      if (!sectionIds.has(sectionId)) {
        addReferenceIssue(context, ['pages', index, 'sectionIds'], sectionId)
      }
    })
    if (page.seoId !== null && !seoIds.has(page.seoId)) {
      addReferenceIssue(context, ['pages', index, 'seoId'], page.seoId)
    }
  })
  graph.sections.forEach((section, index) => {
    if (!pageIds.has(section.pageId)) {
      addReferenceIssue(context, ['sections', index, 'pageId'], section.pageId)
    }
    if (section.formId !== null && !formIds.has(section.formId)) {
      addReferenceIssue(context, ['sections', index, 'formId'], section.formId)
    }
    section.assetIds.forEach(assetId => {
      if (!assetIds.has(assetId)) {
        addReferenceIssue(context, ['sections', index, 'assetIds'], assetId)
      }
    })
    section.integrationIds.forEach(integrationId => {
      if (!integrationIds.has(integrationId)) {
        addReferenceIssue(
          context,
          ['sections', index, 'integrationIds'],
          integrationId
        )
      }
    })
  })
  graph.globalComponents.forEach((component, index) => {
    component.assetIds.forEach(assetId => {
      if (!assetIds.has(assetId)) {
        addReferenceIssue(
          context,
          ['globalComponents', index, 'assetIds'],
          assetId
        )
      }
    })
    component.integrationIds.forEach(integrationId => {
      if (!integrationIds.has(integrationId)) {
        addReferenceIssue(
          context,
          ['globalComponents', index, 'integrationIds'],
          integrationId
        )
      }
    })
  })
  for (const [field, componentId] of [
    ['headerComponentId', graph.chrome.headerComponentId],
    ['footerComponentId', graph.chrome.footerComponentId],
    ...graph.chrome.componentIds.map(id => ['componentIds', id]),
  ] as const) {
    if (!componentIds.has(componentId)) {
      addReferenceIssue(context, ['chrome', field], componentId)
    }
  }
  graph.forms.forEach((form, index) => {
    if (!integrationIds.has(form.integrationId)) {
      addReferenceIssue(
        context,
        ['forms', index, 'integrationId'],
        form.integrationId
      )
    }
    if (
      form.consentLegalResourceId !== null &&
      !legalIds.has(form.consentLegalResourceId)
    ) {
      addReferenceIssue(
        context,
        ['forms', index, 'consentLegalResourceId'],
        form.consentLegalResourceId
      )
    }
  })
  graph.analytics.integrationIds.forEach(integrationId => {
    if (!integrationIds.has(integrationId)) {
      addReferenceIssue(context, ['analytics', 'integrationIds'], integrationId)
    }
  })
  graph.seo.forEach((seo, index) => {
    if (seo.pageId !== null && !pageIds.has(seo.pageId)) {
      addReferenceIssue(context, ['seo', index, 'pageId'], seo.pageId)
    }
    if (
      seo.openGraph.imageAssetId !== null &&
      !assetIds.has(seo.openGraph.imageAssetId)
    ) {
      addReferenceIssue(
        context,
        ['seo', index, 'openGraph', 'imageAssetId'],
        seo.openGraph.imageAssetId
      )
    }
  })
  graph.integrations.forEach((integration, index) => {
    integration.pageIds.forEach(pageId => {
      if (!pageIds.has(pageId)) {
        addReferenceIssue(context, ['integrations', index, 'pageIds'], pageId)
      }
    })
    integration.formIds.forEach(formId => {
      if (!formIds.has(formId)) {
        addReferenceIssue(context, ['integrations', index, 'formIds'], formId)
      }
    })
  })
  ;[
    ...graph.responsiveRules.map(rule => rule.target),
    ...graph.accessibilityAnnotations.map(annotation => annotation.target),
  ].forEach(target => {
    const resource = resourceById.get(target.resourceId)
    if (!resource || resource.kind !== target.resourceKind) {
      addReferenceIssue(context, ['resourceTarget'], target.resourceId)
    }
  })
  graph.removals.forEach((removal, index) => {
    if (resourceById.has(removal.resourceId)) {
      context.addIssue({
        code: 'custom',
        path: ['removals', index, 'resourceId'],
        message: 'A desired resource cannot also have a removal tombstone',
      })
    }
  })
  addUniqueIssues(
    graph.assets,
    asset => asset.assetId,
    context,
    ['assets'],
    'Asset ids'
  )
  addUniqueIssues(
    graph.removals,
    removal => `${removal.resourceKind}:${removal.resourceId}`,
    context,
    ['removals'],
    'Removal tombstones'
  )
  graph.forms.forEach((form, index) => {
    addUniqueIssues(
      form.fields,
      field => field.fieldId,
      context,
      ['forms', index, 'fields'],
      'Form field ids'
    )
  })
  addUniqueIssues(
    graph.pages,
    page => page.slug,
    context,
    ['pages'],
    'Page slugs'
  )
  addUniqueIssues(
    graph.redirects,
    redirect => redirect.sourcePath,
    context,
    ['redirects'],
    'Redirect sources'
  )
}

function graphResourceEntries(
  graph: z.infer<typeof runtimeV3ResourceGraphSchema>
) {
  return [
    ...graph.pages.map(resource => ({ kind: 'page' as const, resource })),
    ...graph.sections.map(resource => ({ kind: 'section' as const, resource })),
    ...graph.globalComponents.map(resource => ({
      kind: 'global_component' as const,
      resource,
    })),
    { kind: 'chrome' as const, resource: graph.chrome },
    ...graph.forms.map(resource => ({ kind: 'form' as const, resource })),
    ...graph.redirects.map(resource => ({ kind: 'redirect' as const, resource })),
    ...graph.responsiveRules.map(resource => ({
      kind: 'responsive_rule' as const,
      resource,
    })),
    ...graph.accessibilityAnnotations.map(resource => ({
      kind: 'accessibility_annotation' as const,
      resource,
    })),
    ...graph.seo.map(resource => ({ kind: 'seo' as const, resource })),
    ...graph.legal.map(resource => ({ kind: 'legal' as const, resource })),
    { kind: 'analytics' as const, resource: graph.analytics },
    ...graph.integrations.map(resource => ({
      kind: 'integration' as const,
      resource,
    })),
    ...graph.assets.map(resource => ({ kind: 'asset' as const, resource })),
  ]
}

function addUniqueIssues<T>(
  values: readonly T[],
  key: (value: T) => string,
  context: z.RefinementCtx,
  path: PropertyKey[],
  label: string
): void {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    const candidate = key(value)
    if (seen.has(candidate)) {
      context.addIssue({
        code: 'custom',
        path: [...path, index],
        message: `${label} must be unique`,
      })
    }
    seen.add(candidate)
  })
}

function addReferenceIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  resourceId: string
): void {
  context.addIssue({
    code: 'custom',
    path,
    message: `Resource reference ${resourceId} does not exist`,
  })
}

function addHashIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  name: string
): void {
  context.addIssue({
    code: 'custom',
    path,
    message: `Exact ${name} digest does not match its payload`,
  })
}
