import { createServiceClient } from '@/utils/supabase/admin'
import {
  getSupabasePublishableKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from '@/utils/supabase/config'

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
  const database = await runDatabaseHealthCheck()

  const checks: HealthReport['checks'] = {
    ...staticChecks,
    database,
  }

  return {
    status: summarizeHealthStatus(checks),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    checks,
  }
}
