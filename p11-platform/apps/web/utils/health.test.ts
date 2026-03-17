import {
  getStaticHealthChecks,
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
})
