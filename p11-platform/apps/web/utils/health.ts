import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  getSupabasePublishableKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from '@/utils/supabase/config'
import {
  isCloudwaysThemeInstallationConfigured,
  isSiteForgeSemanticEditorEnabled,
} from '@/utils/siteforge/editor/feature'
import { hasCloudwaysProviderCredentials } from '@/utils/siteforge/providers/cloudways-provider'

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy'

export interface HealthCheckResult {
  status: HealthStatus
  required: boolean
  message: string
  details?: Record<string, unknown>
}

export interface HealthReport {
  status: HealthStatus
  timestamp: string
  environment: string
  checks: {
    env: HealthCheckResult
    database: HealthCheckResult
    openai: HealthCheckResult
    dataEngine: HealthCheckResult
    siteforge: HealthCheckResult
  }
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value && value.trim())
}

export function summarizeHealthStatus(
  checks: Record<string, HealthCheckResult>
): HealthStatus {
  const values = Object.values(checks)

  if (values.some(check => check.required && check.status === 'unhealthy')) {
    return 'unhealthy'
  }

  if (values.some(check => check.status !== 'healthy')) {
    return 'degraded'
  }

  return 'healthy'
}

export function getStaticHealthChecks(): Omit<HealthReport['checks'], 'database'> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const openAiKey = process.env.OPENAI_API_KEY
  const dataEngineUrl = process.env.DATA_ENGINE_URL

  const envOk = hasValue(url) && hasValue(publishableKey) && hasValue(serviceRoleKey)

  return {
    env: {
      status: envOk ? 'healthy' : 'unhealthy',
      required: true,
      message: envOk
        ? 'Supabase runtime environment variables are configured'
        : 'Missing one or more required Supabase environment variables',
      details: {
        hasUrl: hasValue(url),
        hasPublishableKey: hasValue(publishableKey),
        hasServiceRoleKey: hasValue(serviceRoleKey),
      },
    },
    openai: {
      status: hasValue(openAiKey) ? 'healthy' : 'degraded',
      required: false,
      message: hasValue(openAiKey)
        ? 'OpenAI API key is configured'
        : 'OpenAI API key is not configured',
    },
    dataEngine: {
      status: hasValue(dataEngineUrl) ? 'healthy' : 'degraded',
      required: false,
      message: hasValue(dataEngineUrl)
        ? 'Data engine URL is configured'
        : 'Data engine URL is not configured',
      details: dataEngineUrl ? { url: dataEngineUrl } : undefined,
    },
    siteforge: {
      status: 'degraded',
      required: true,
      message: 'SiteForge runtime dependencies have not been checked yet',
    },
  }
}

const SITEFORGE_RUNTIME_ARCHIVES = [
  'oneclick-siteforge.zip',
  'advanced-custom-fields-pro.zip',
] as const

async function verifyArchiveDigest(
  runtimeAssetsDir: string,
  filename: string
): Promise<boolean> {
  try {
    const [archive, digestFile] = await Promise.all([
      readFile(path.join(runtimeAssetsDir, filename)),
      readFile(path.join(runtimeAssetsDir, `${filename}.sha256`), 'utf8'),
    ])
    const match = digestFile
      .trim()
      .match(/^([a-f0-9]{64})\s+\*?([^\s]+)$/i)
    if (
      archive.length < 100 ||
      archive[0] !== 0x50 ||
      archive[1] !== 0x4b ||
      !match ||
      match[2] !== filename
    ) {
      return false
    }
    return createHash('sha256').update(archive).digest('hex') === match[1].toLowerCase()
  } catch {
    return false
  }
}

export async function runSiteForgeReadinessCheck({
  runtimeAssetsDir = path.resolve(process.cwd(), 'runtime-assets'),
  env = process.env,
}: {
  runtimeAssetsDir?: string
  env?: Record<string, string | undefined>
} = {}): Promise<HealthCheckResult> {
  const artifactChecks = await Promise.all(
    SITEFORGE_RUNTIME_ARCHIVES.map(async filename => [
      filename,
      await verifyArchiveDigest(runtimeAssetsDir, filename),
    ] as const)
  )
  const artifacts = Object.fromEntries(artifactChecks)
  const artifactsReady = artifactChecks.every(([, ready]) => ready)
  const hasAcfLicense = hasValue(env.SITEFORGE_ACF_PRO_LICENSE_KEY)
  const semanticEditorEnabled = isSiteForgeSemanticEditorEnabled(
    env.SITEFORGE_SEMANTIC_EDITOR_ENABLED
  )
  const hasOverlaySigningSecret = hasValue(
    env.SITEFORGE_OVERLAY_SIGNING_SECRET
  )
  const anthropicConfigured = hasValue(env.ANTHROPIC_API_KEY)
  const cloudwaysValuesPresent = [
    env.CLOUDWAYS_ACCESS_TOKEN,
    env.CLOUDWAYS_API_KEY,
    env.CLOUDWAYS_EMAIL,
  ].filter(hasValue).length
  const cloudwaysConfigured = isCloudwaysThemeInstallationConfigured({
    accessToken: env.CLOUDWAYS_ACCESS_TOKEN,
    apiKey: env.CLOUDWAYS_API_KEY,
    email: env.CLOUDWAYS_EMAIL,
    acfLicenseKey: env.SITEFORGE_ACF_PRO_LICENSE_KEY,
  })
  const wordpressConfigured = [
    env.SITEFORGE_WP_URL,
    env.SITEFORGE_WP_USERNAME,
    env.SITEFORGE_WP_APP_PASSWORD,
  ].filter(hasValue).length
  const previewWordPressConfigured = [
    env.SITEFORGE_PREVIEW_WP_URL,
    env.SITEFORGE_PREVIEW_WP_USERNAME,
    env.SITEFORGE_PREVIEW_WP_APP_PASSWORD,
  ].filter(hasValue).length
  const optionalProviderConfigComplete =
    (cloudwaysValuesPresent === 0 || cloudwaysConfigured) &&
    (wordpressConfigured === 0 || wordpressConfigured === 3)
  const requiredConfigReady =
    hasAcfLicense && (!semanticEditorEnabled || hasOverlaySigningSecret)

  const status: HealthStatus =
    !artifactsReady || !requiredConfigReady
      ? 'unhealthy'
      : optionalProviderConfigComplete
        ? 'healthy'
        : 'degraded'

  return {
    status,
    required: true,
    message:
      status === 'healthy'
        ? 'SiteForge runtime artifacts and required configuration are ready'
        : status === 'degraded'
          ? 'SiteForge is ready, but an optional provider is partially configured'
          : 'SiteForge runtime artifacts or required configuration are missing',
    details: {
      artifacts,
      hasAcfLicense,
      semanticEditorEnabled,
      hasOverlaySigningSecret,
      anthropicConfigured,
      cloudwaysConfigured,
      cloudwaysCredentialsPresent: hasCloudwaysProviderCredentials(env),
      wordpressConfigured: wordpressConfigured === 3,
      previewWordPressConfigured: previewWordPressConfigured === 3,
    },
  }
}

export async function runDatabaseHealthCheck(): Promise<HealthCheckResult> {
  try {
    // Force config resolution here so env errors become explicit.
    getSupabaseUrl()
    getSupabasePublishableKey()
    getSupabaseServiceRoleKey()

    const supabase = createServiceClient()
    const { count, error } = await supabase
      .from('organizations')
      .select('*', { count: 'exact', head: true })

    if (error) {
      return {
        status: 'unhealthy',
        required: true,
        message: 'Database query failed',
        details: {
          code: error.code,
          message: error.message,
        },
      }
    }

    return {
      status: 'healthy',
      required: true,
      message: 'Database connection succeeded',
      details: {
        organizationsCount: count ?? 0,
      },
    }
  } catch (error) {
    return {
      status: 'unhealthy',
      required: true,
      message: 'Database client initialization failed',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    }
  }
}

export async function buildHealthReport(): Promise<HealthReport> {
  const staticChecks = getStaticHealthChecks()
  const [database, siteforge] = await Promise.all([
    runDatabaseHealthCheck(),
    runSiteForgeReadinessCheck(),
  ])

  const checks: HealthReport['checks'] = {
    ...staticChecks,
    database,
    siteforge,
  }

  return {
    status: summarizeHealthStatus(checks),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    checks,
  }
}
