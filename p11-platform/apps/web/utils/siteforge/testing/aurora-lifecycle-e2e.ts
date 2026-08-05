export type Environment = Record<string, string | undefined>

export const AURORA_LIFECYCLE_REQUIRED_ENV = [
  'AURORA_LIFECYCLE_E2E',
  'PLAYWRIGHT_BASE_URL',
  'AURORA_LIFECYCLE_PROPERTY_ID',
  'AURORA_LIFECYCLE_WEBSITE_ID',
  'AURORA_LIFECYCLE_TARGET_ID',
  'AURORA_LIFECYCLE_ROLLOUT_ASSIGNMENT_ID',
  'AURORA_LIFECYCLE_RUNTIME_PACKAGE_SHA256',
  'AURORA_LIFECYCLE_RUNTIME_MANIFEST_SHA256',
  'AURORA_LIFECYCLE_BASE_THEME_PACKAGE_SHA256',
  'AURORA_LIFECYCLE_RUNTIME_SIGNING_KEY_ID',
  'AURORA_LIFECYCLE_OWNER_ID',
  'AURORA_LIFECYCLE_EXPIRES_AT',
  'AURORA_LIFECYCLE_OPERATOR_PROFILE_ID',
  'AURORA_LIFECYCLE_OPERATOR_EMAIL',
  'AURORA_LIFECYCLE_OPERATOR_PASSWORD',
  'AURORA_LIFECYCLE_REVIEWER_PROFILE_ID',
  'AURORA_LIFECYCLE_REVIEWER_EMAIL',
  'AURORA_LIFECYCLE_REVIEWER_PASSWORD',
  'AURORA_LIFECYCLE_CLEANUP_CONFIRM',
  'AURORA_LIFECYCLE_TARGET_URL',
  'AURORA_LIFECYCLE_EXPECTED_URLS',
  'AURORA_LIFECYCLE_STAGING_APPLICATION_ID',
  'AURORA_LIFECYCLE_STAGING_OPERATION_ID',
  'SITEFORGE_AURORA_LIFECYCLE_CONTROL_ENABLED',
  'SITEFORGE_AURORA_LIFECYCLE_CONTROL_SECRET',
  'SITEFORGE_RUNTIME_V3_ENABLED',
  'SITEFORGE_SEMANTIC_EDITOR_ENABLED',
  'SITEFORGE_RUNTIME_EXTENSIONS_ENABLED',
  'SITEFORGE_REQUIRE_TRUSTED_CERTIFICATION',
  'SITEFORGE_RUNTIME_V3_PUBLIC_KEYS',
  'SITEFORGE_OVERLAY_SIGNING_SECRET',
  'SITEFORGE_PROMOTION_TOKEN_SECRET',
  'SITEFORGE_BROWSER_CERTIFIER_URL',
  'SITEFORGE_BROWSER_CERTIFIER_SECRET',
  'SITEFORGE_LIGHTHOUSE_PROVIDER_URL',
  'SITEFORGE_LIGHTHOUSE_PROVIDER_SECRET',
  'SITEFORGE_ACF_PRO_LICENSE_KEY',
  'SITEFORGE_PREVIEW_WP_URL',
  'SITEFORGE_PREVIEW_WP_USERNAME',
  'SITEFORGE_PREVIEW_WP_APP_PASSWORD',
  'BROWSERBASE_API_KEY',
  'BROWSERBASE_PROJECT_ID',
  'CLOUDWAYS_API_KEY',
  'CLOUDWAYS_EMAIL',
] as const

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[a-f0-9]{64}$/i
const TRUE_FLAGS = [
  'SITEFORGE_AURORA_LIFECYCLE_CONTROL_ENABLED',
  'SITEFORGE_RUNTIME_V3_ENABLED',
  'SITEFORGE_SEMANTIC_EDITOR_ENABLED',
  'SITEFORGE_RUNTIME_EXTENSIONS_ENABLED',
  'SITEFORGE_REQUIRE_TRUSTED_CERTIFICATION',
] as const
export const AURORA_LIFECYCLE_CONTROL_PATHS = {
  lease: '/api/test-only/siteforge/aurora-lifecycle/lease',
  import: '/api/test-only/siteforge/aurora-lifecycle/import',
  resources: '/api/test-only/siteforge/aurora-lifecycle/resources',
  providerOperations:
    '/api/test-only/siteforge/aurora-lifecycle/provider-operations',
  cleanup: '/api/test-only/siteforge/aurora-lifecycle/cleanup',
} as const
const UUID_FIELDS = [
  'AURORA_LIFECYCLE_PROPERTY_ID',
  'AURORA_LIFECYCLE_WEBSITE_ID',
  'AURORA_LIFECYCLE_TARGET_ID',
  'AURORA_LIFECYCLE_ROLLOUT_ASSIGNMENT_ID',
  'AURORA_LIFECYCLE_OWNER_ID',
  'AURORA_LIFECYCLE_OPERATOR_PROFILE_ID',
  'AURORA_LIFECYCLE_REVIEWER_PROFILE_ID',
] as const
const SHA_FIELDS = [
  'AURORA_LIFECYCLE_RUNTIME_PACKAGE_SHA256',
  'AURORA_LIFECYCLE_RUNTIME_MANIFEST_SHA256',
  'AURORA_LIFECYCLE_BASE_THEME_PACKAGE_SHA256',
] as const

export type AuroraLifecycleConfig = {
  propertyId: string
  websiteId: string
  targetId: string
  rolloutAssignmentId: string
  startArtifactId: string
  startContentHash: string
  rollbackArtifactId: string
  rollbackContentHash: string
  runtimePackageSha256: string
  runtimeManifestSha256: string
  baseThemePackageSha256: string
  runtimeSigningKeyId: string
  ownerId: string
  expiresAt: string
  operator: { profileId: string; email: string; password: string }
  reviewer: { profileId: string; email: string; password: string }
  leaseUrl: string
  importUrl: string
  resourcesUrl: string
  providerOperationsUrl: string
  cleanupUrl: string
  targetUrl: string
  expectedUrls: string[]
  backupOperationId: string
  backupId: string
  promotionOperationId: string
  restoreOperationId: string
  stagingApplicationId: string
  stagingOperationId: string
  controlSecret: string
}

export type AuroraPreflight =
  | { ready: true; config: AuroraLifecycleConfig; missing: []; invalid: [] }
  | { ready: false; missing: string[]; invalid: string[] }

function value(env: Environment, key: string): string {
  return env[key]?.trim() || ''
}

function parseExpectedUrls(raw: string): string[] {
  const parsed = raw.startsWith('[')
    ? (JSON.parse(raw) as unknown)
    : raw.split(',').map(item => item.trim()).filter(Boolean)
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some(item => typeof item !== 'string')
  ) {
    throw new Error('expected a non-empty URL array')
  }
  return parsed
}

export function inspectAuroraLifecycleEnv(
  env: Environment,
  now = new Date()
): AuroraPreflight {
  const missing = AURORA_LIFECYCLE_REQUIRED_ENV.filter(key => !value(env, key))
  if (missing.length) return { ready: false, missing: [...missing], invalid: [] }

  const invalid: string[] = []
  for (const key of UUID_FIELDS) {
    if (!UUID.test(value(env, key))) invalid.push(`${key} (must be a UUID)`)
  }
  for (const key of SHA_FIELDS) {
    if (!SHA256.test(value(env, key))) {
      invalid.push(`${key} (must be a SHA-256 digest)`)
    }
  }
  for (const key of TRUE_FLAGS) {
    if (value(env, key) !== 'true') invalid.push(`${key} (must equal true)`)
  }
  if (value(env, 'AURORA_LIFECYCLE_E2E') !== '1') {
    invalid.push('AURORA_LIFECYCLE_E2E (must equal 1)')
  }
  if (value(env, 'AURORA_LIFECYCLE_CLEANUP_CONFIRM') !== 'DELETE_OWNED_AURORA_RESOURCES') {
    invalid.push(
      'AURORA_LIFECYCLE_CLEANUP_CONFIRM (must equal DELETE_OWNED_AURORA_RESOURCES)'
    )
  }
  if (
    value(env, 'AURORA_LIFECYCLE_OPERATOR_PROFILE_ID') ===
    value(env, 'AURORA_LIFECYCLE_REVIEWER_PROFILE_ID')
  ) {
    invalid.push('AURORA_LIFECYCLE_REVIEWER_PROFILE_ID (must be independent)')
  }
  if (
    value(env, 'AURORA_LIFECYCLE_OPERATOR_EMAIL').toLowerCase() ===
    value(env, 'AURORA_LIFECYCLE_REVIEWER_EMAIL').toLowerCase()
  ) {
    invalid.push('AURORA_LIFECYCLE_REVIEWER_EMAIL (must be independent)')
  }
  const expiresAt = new Date(value(env, 'AURORA_LIFECYCLE_EXPIRES_AT'))
  const ttl = expiresAt.getTime() - now.getTime()
  if (!Number.isFinite(expiresAt.getTime()) || ttl <= 0 || ttl > 24 * 60 * 60_000) {
    invalid.push('AURORA_LIFECYCLE_EXPIRES_AT (must be within the next 24 hours)')
  }

  if (value(env, 'SITEFORGE_AURORA_LIFECYCLE_CONTROL_SECRET').length < 32) {
    invalid.push(
      'SITEFORGE_AURORA_LIFECYCLE_CONTROL_SECRET (must contain at least 32 characters)'
    )
  }

  let expectedUrls: string[] = []
  try {
    expectedUrls = parseExpectedUrls(
      value(env, 'AURORA_LIFECYCLE_EXPECTED_URLS')
    )
    const target = new URL(value(env, 'AURORA_LIFECYCLE_TARGET_URL'))
    const targetOrigin = target.origin
    const targetIdentity = `${target.hostname}${target.pathname}`.toLowerCase()
    if (
      targetIdentity.includes('acacia') ||
      targetIdentity.includes('dividendhomes.com/acacia')
    ) {
      invalid.push(
        'AURORA_LIFECYCLE_TARGET_URL (must not identify Acacia)'
      )
    }
    if (expectedUrls.some(url => new URL(url).origin !== targetOrigin)) {
      invalid.push(
        'AURORA_LIFECYCLE_EXPECTED_URLS (all URLs must share target origin)'
      )
    }
  } catch {
    invalid.push('AURORA_LIFECYCLE_EXPECTED_URLS (must contain valid URLs)')
  }

  if (invalid.length) return { ready: false, missing: [], invalid }
  return {
    ready: true,
    missing: [],
    invalid: [],
    config: {
      propertyId: value(env, 'AURORA_LIFECYCLE_PROPERTY_ID'),
      websiteId: value(env, 'AURORA_LIFECYCLE_WEBSITE_ID'),
      targetId: value(env, 'AURORA_LIFECYCLE_TARGET_ID'),
      rolloutAssignmentId: value(
        env,
        'AURORA_LIFECYCLE_ROLLOUT_ASSIGNMENT_ID'
      ),
      startArtifactId: '',
      startContentHash: '',
      rollbackArtifactId: '',
      rollbackContentHash: '',
      runtimePackageSha256: value(
        env,
        'AURORA_LIFECYCLE_RUNTIME_PACKAGE_SHA256'
      ),
      runtimeManifestSha256: value(
        env,
        'AURORA_LIFECYCLE_RUNTIME_MANIFEST_SHA256'
      ),
      baseThemePackageSha256: value(
        env,
        'AURORA_LIFECYCLE_BASE_THEME_PACKAGE_SHA256'
      ),
      runtimeSigningKeyId: value(
        env,
        'AURORA_LIFECYCLE_RUNTIME_SIGNING_KEY_ID'
      ),
      ownerId: value(env, 'AURORA_LIFECYCLE_OWNER_ID'),
      expiresAt: expiresAt.toISOString(),
      operator: {
        profileId: value(env, 'AURORA_LIFECYCLE_OPERATOR_PROFILE_ID'),
        email: value(env, 'AURORA_LIFECYCLE_OPERATOR_EMAIL'),
        password: value(env, 'AURORA_LIFECYCLE_OPERATOR_PASSWORD'),
      },
      reviewer: {
        profileId: value(env, 'AURORA_LIFECYCLE_REVIEWER_PROFILE_ID'),
        email: value(env, 'AURORA_LIFECYCLE_REVIEWER_EMAIL'),
        password: value(env, 'AURORA_LIFECYCLE_REVIEWER_PASSWORD'),
      },
      leaseUrl: AURORA_LIFECYCLE_CONTROL_PATHS.lease,
      importUrl: AURORA_LIFECYCLE_CONTROL_PATHS.import,
      resourcesUrl: AURORA_LIFECYCLE_CONTROL_PATHS.resources,
      providerOperationsUrl:
        AURORA_LIFECYCLE_CONTROL_PATHS.providerOperations,
      cleanupUrl: AURORA_LIFECYCLE_CONTROL_PATHS.cleanup,
      targetUrl: value(env, 'AURORA_LIFECYCLE_TARGET_URL'),
      expectedUrls,
      backupOperationId: '',
      backupId: '',
      promotionOperationId: value(
        env,
        'AURORA_LIFECYCLE_PROMOTION_OPERATION_ID'
      ),
      restoreOperationId: '',
      stagingApplicationId: value(
        env,
        'AURORA_LIFECYCLE_STAGING_APPLICATION_ID'
      ),
      stagingOperationId: value(
        env,
        'AURORA_LIFECYCLE_STAGING_OPERATION_ID'
      ),
      controlSecret: value(
        env,
        'SITEFORGE_AURORA_LIFECYCLE_CONTROL_SECRET'
      ),
    },
  }
}

export function auroraMutationHeaders(config: AuroraLifecycleConfig) {
  return {
    Authorization: `Bearer ${config.controlSecret}`,
    'x-p11-test-owner-id': config.ownerId,
    'x-p11-test-expires-at': config.expiresAt,
    'x-p11-test-property-id': config.propertyId,
    'x-p11-test-website-id': config.websiteId,
    'x-p11-test-target-id': config.targetId,
    'x-p11-test-rollout-assignment-id': config.rolloutAssignmentId,
  }
}

export function formatAuroraPreflightFailure(preflight: AuroraPreflight): string {
  if (preflight.ready) return ''
  const parts = []
  if (preflight.missing.length) {
    parts.push(`missing: ${preflight.missing.join(', ')}`)
  }
  if (preflight.invalid.length) {
    parts.push(`invalid: ${preflight.invalid.join(', ')}`)
  }
  return `Aurora lifecycle preflight failed closed (${parts.join('; ')})`
}
