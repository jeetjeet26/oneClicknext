import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const processWorkflowsMock = vi.fn()
const startCronJobRunMock = vi.fn()
const finishCronJobRunMock = vi.fn()

vi.mock('@/utils/services/workflow-processor', () => ({
  processWorkflows: processWorkflowsMock,
}))

vi.mock('@/utils/services/cron-job-runs', () => ({
  startCronJobRun: startCronJobRunMock,
  finishCronJobRun: finishCronJobRunMock,
}))

describe('GET /api/workflows/process', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    startCronJobRunMock.mockResolvedValue({
      id: 'run-1',
      jobName: 'workflows-process',
      startedAtMs: 0,
    })
    finishCronJobRunMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns 401 when the cron secret is invalid in production mode', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      CRON_SECRET: 'expected-secret',
    })

    const { GET } = await import('./route')

    const request = new Request('http://localhost/api/workflows/process', {
      method: 'GET',
      headers: {
        authorization: 'Bearer wrong-secret',
      },
    }) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns workflow processing results when the cron secret is valid', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      CRON_SECRET: 'expected-secret',
    })
    processWorkflowsMock.mockResolvedValue({
      processed: 3,
      succeeded: 3,
      failed: 0,
      errors: [],
    })

    const { GET } = await import('./route')

    const request = new Request('http://localhost/api/workflows/process', {
      method: 'GET',
      headers: {
        authorization: 'Bearer expected-secret',
      },
    }) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toMatchObject({
      success: true,
      processed: 3,
      succeeded: 3,
      failed: 0,
      errors: [],
    })
  })
})
