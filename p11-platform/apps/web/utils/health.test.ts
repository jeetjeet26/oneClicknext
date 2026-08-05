import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  getStaticHealthChecks,
  runSiteForgeReadinessCheck,
  summarizeHealthStatus,
  type HealthCheckResult,
} from './health'

describe('health utilities', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('reports healthy when all checks are healthy', () => {
    const checks: Record<string, HealthCheckResult> = {
      env: { status: 'healthy', required: true, message: 'ok' },
      database: { status: 'healthy', required: true, message: 'ok' },
      openai: { status: 'healthy', required: false, message: 'ok' },
    }

    expect(summarizeHealthStatus(checks)).toBe('healthy')
  })

  it('reports degraded when only optional checks are degraded', () => {
    const checks: Record<string, HealthCheckResult> = {
      env: { status: 'healthy', required: true, message: 'ok' },
      database: { status: 'healthy', required: true, message: 'ok' },
      openai: { status: 'degraded', required: false, message: 'missing' },
    }

    expect(summarizeHealthStatus(checks)).toBe('degraded')
  })

  it('reports unhealthy when a required check is unhealthy', () => {
    const checks: Record<string, HealthCheckResult> = {
      env: { status: 'healthy', required: true, message: 'ok' },
      database: { status: 'unhealthy', required: true, message: 'down' },
      openai: { status: 'healthy', required: false, message: 'ok' },
    }

    expect(summarizeHealthStatus(checks)).toBe('unhealthy')
  })

  it('marks env unhealthy when required Supabase env vars are missing', () => {
    Reflect.deleteProperty(process.env, 'NEXT_PUBLIC_SUPABASE_URL')
    Reflect.deleteProperty(process.env, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
    Reflect.deleteProperty(process.env, 'NEXT_PUBLIC_SUPABASE_ANON_KEY')
    Reflect.deleteProperty(process.env, 'SUPABASE_SERVICE_ROLE_KEY')

    const checks = getStaticHealthChecks()

    expect(checks.env.status).toBe('unhealthy')
    expect(checks.env.required).toBe(true)
  })

  it('reports SiteForge ready without requiring an optional provider', async () => {
    const runtimeAssetsDir = await mkdtemp(
      path.join(tmpdir(), 'siteforge-health-')
    )
    try {
      for (const filename of [
        'oneclick-siteforge.zip',
        'advanced-custom-fields-pro.zip',
      ]) {
        const archive = Buffer.alloc(128)
        archive[0] = 0x50
        archive[1] = 0x4b
        const digest = createHash('sha256').update(archive).digest('hex')
        await writeFile(path.join(runtimeAssetsDir, filename), archive)
        await writeFile(
          path.join(runtimeAssetsDir, `${filename}.sha256`),
          `${digest}  ${filename}\n`
        )
      }

      const check = await runSiteForgeReadinessCheck({
        runtimeAssetsDir,
        env: {
          SITEFORGE_ACF_PRO_LICENSE_KEY: 'configured',
          ANTHROPIC_API_KEY: 'configured',
          SITEFORGE_PREVIEW_WP_URL: 'https://wordpress.example.com',
          SITEFORGE_PREVIEW_WP_USERNAME: 'siteforge',
          SITEFORGE_PREVIEW_WP_APP_PASSWORD: 'application-password',
        },
      })

      expect(check.status).toBe('healthy')
      expect(check.required).toBe(true)
      expect(check.details?.anthropicConfigured).toBe(true)
      expect(check.details?.previewWordPressConfigured).toBe(true)
    } finally {
      await rm(runtimeAssetsDir, { recursive: true, force: true })
    }
  })

  it('rejects missing required artifacts but only degrades partial providers', async () => {
    const missing = await runSiteForgeReadinessCheck({
      runtimeAssetsDir: path.join(tmpdir(), 'missing-siteforge-assets'),
      env: { SITEFORGE_ACF_PRO_LICENSE_KEY: 'configured' },
    })
    expect(missing.status).toBe('unhealthy')

    const runtimeAssetsDir = await mkdtemp(
      path.join(tmpdir(), 'siteforge-health-')
    )
    try {
      for (const filename of [
        'oneclick-siteforge.zip',
        'advanced-custom-fields-pro.zip',
      ]) {
        const archive = Buffer.alloc(128)
        archive[0] = 0x50
        archive[1] = 0x4b
        const digest = createHash('sha256').update(archive).digest('hex')
        await writeFile(path.join(runtimeAssetsDir, filename), archive)
        await writeFile(
          path.join(runtimeAssetsDir, `${filename}.sha256`),
          `${digest}  ${filename}\n`
        )
      }
      const partialProvider = await runSiteForgeReadinessCheck({
        runtimeAssetsDir,
        env: {
          SITEFORGE_ACF_PRO_LICENSE_KEY: 'configured',
          CLOUDWAYS_API_KEY: 'partial',
        },
      })
      expect(partialProvider.status).toBe('degraded')
      const placeholderProvider = await runSiteForgeReadinessCheck({
        runtimeAssetsDir,
        env: {
          SITEFORGE_ACF_PRO_LICENSE_KEY: 'configured',
          CLOUDWAYS_API_KEY: 'placeholder',
          CLOUDWAYS_EMAIL: 'placeholder',
        },
      })
      expect(placeholderProvider.status).toBe('degraded')
      expect(placeholderProvider.details?.cloudwaysConfigured).toBe(false)
    } finally {
      await rm(runtimeAssetsDir, { recursive: true, force: true })
    }
  })
})
