import { describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(),
}))
vi.mock('@/utils/services/cron-job-runs', () => ({
  startCronJobRun: vi.fn(),
  finishCronJobRun: vi.fn(),
}))

describe('SiteForge production health cron route', () => {
  it('rejects requests without cron authentication', async () => {
    const previous = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'health-cron-secret'
    try {
      const { GET } = await import('./route')
      const response = await GET(
        new Request('http://localhost/api/cron/siteforge-production-health') as NextRequest
      )
      expect(response.status).toBe(401)
    } finally {
      process.env.CRON_SECRET = previous
    }
  })
})
