import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ process: vi.fn(), start: vi.fn(), finish: vi.fn() }))
vi.mock('@/utils/services/workflow-processor', () => ({ processWorkflows: mocks.process }))
vi.mock('@/utils/services/cron-job-runs', async importOriginal => ({
  ...await importOriginal<typeof import('@/utils/services/cron-job-runs')>(),
  startCronJobRun: mocks.start, finishCronJobRun: mocks.finish, confirmCronJobRun: mocks.finish,
}))
import { GET } from './route'

function request(secret = 'expected-secret') {
  return new Request('http://localhost/api/workflows/process', {
    headers: { authorization: `Bearer ${secret}` },
  }) as NextRequest
}

describe('workflow run reporting', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.start.mockResolvedValue({ id: 'run-1' })
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CRON_SECRET', 'expected-secret')
  })

  afterEach(() => vi.unstubAllEnvs())

  it('rejects invalid cron credentials before processing or recording a run', async () => {
    const response = await GET(request('wrong-secret'))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mocks.process).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('records a failure if processing throws', async () => {
    mocks.process.mockRejectedValue(new Error('Test processing failure'))
    expect((await GET(request())).status).toBe(500)
    expect(mocks.finish).toHaveBeenCalledWith({ id: 'run-1' }, expect.objectContaining({ status: 'failed' }))
  })

  it.each([
    { succeeded: 0, failed: 2, errors: ['Provider unavailable'], status: 'failed', http: 503 },
    { succeeded: 1, failed: 1, errors: ['One action failed'], status: 'partial', http: 200 },
    { succeeded: 0, failed: 0, errors: ['Could not fetch workflows'], status: 'failed', http: 503 },
    { succeeded: 2, failed: 0, errors: [], status: 'success', http: 200 },
    { succeeded: 0, failed: 0, errors: [], status: 'success', http: 200 },
  ])('reports $status for $succeeded succeeded / $failed failed', async outcome => {
    mocks.process.mockResolvedValue({ processed: outcome.succeeded + outcome.failed,
      succeeded: outcome.succeeded, failed: outcome.failed, errors: outcome.errors })
    const response = await GET(request())
    expect(response.status).toBe(outcome.http)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(await response.json()).toMatchObject({ success: outcome.status === 'success', status: outcome.status })
    expect(mocks.finish).toHaveBeenCalledWith({ id: 'run-1' }, expect.objectContaining({ status: outcome.status }))
  })
})
