import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/runtime-config', () => ({
  getDataEngineUrl: () => 'http://data-engine.test',
  getDataEngineHeaders: () => ({
    'Content-Type': 'application/json',
    'X-API-Key': 'engine-key',
  }),
}))

function makeNextRequest(url: string): NextRequest {
  return new Request(url) as NextRequest
}

function mockJobLookup() {
  const singleMock = vi.fn().mockResolvedValue({ data: { property_id: 'property-1' }, error: null })
  const eqMock = vi.fn().mockReturnValue({ single: singleMock })
  const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
  fromMock.mockReturnValue({ select: selectMock })
}

describe('marketvision brand-intelligence job route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReset()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/marketvision/brand-intelligence/job/job-1'),
      { params: Promise.resolve({ jobId: 'job-1' }) },
    )
    expect(response.status).toBe(401)
  })

  it('GET returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })
    const singleMock = vi.fn().mockResolvedValue({ data: { property_id: 'property-1' }, error: null })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/marketvision/brand-intelligence/job/job-1'),
      { params: Promise.resolve({ jobId: 'job-1' }) },
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })
})

describe('marketvision brand-intelligence job route contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReset()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
  })

  it('GET unwraps the data-engine { success, data } payload and maps canonical states', async () => {
    mockJobLookup()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: {
          job_id: 'job-1',
          status: 'processing',
          total_competitors: 10,
          processed_count: 4,
          failed_count: 1,
          current_batch: 2,
          total_batches: 4,
          progress_percent: 50,
          started_at: '2026-07-21T00:00:00Z',
          completed_at: null,
          error_message: null,
        },
      }),
    }) as typeof fetch

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/marketvision/brand-intelligence/job/job-1'),
      { params: Promise.resolve({ jobId: 'job-1' }) },
    )

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.job).toMatchObject({
      jobId: 'job-1',
      status: 'running',
      rawStatus: 'processing',
      result: null,
      totalCompetitors: 10,
      processedCount: 4,
      failedCount: 1,
      progressPercent: 50,
    })
    expect(global.fetch).toHaveBeenCalledWith(
      'http://data-engine.test/scraper/brand-intelligence/job/job-1?property_id=property-1',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-API-Key': 'engine-key' }),
      }),
    )
  })

  it('GET derives a partial result for succeeded jobs with failures', async () => {
    mockJobLookup()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: {
          job_id: 'job-1',
          status: 'completed',
          total_competitors: 10,
          processed_count: 7,
          failed_count: 3,
          current_batch: 4,
          total_batches: 4,
          progress_percent: 100,
          started_at: '2026-07-21T00:00:00Z',
          completed_at: '2026-07-21T00:10:00Z',
          error_message: null,
        },
      }),
    }) as typeof fetch

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/marketvision/brand-intelligence/job/job-1'),
      { params: Promise.resolve({ jobId: 'job-1' }) },
    )

    const json = await response.json()
    expect(json.job.status).toBe('succeeded')
    expect(json.job.result).toBe('partial')
    expect(json.job.failedCount).toBe(3)
  })

  it('GET rejects malformed data-engine payloads instead of returning undefined fields', async () => {
    mockJobLookup()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ job_id: 'job-1', status: 'processing' }),
    }) as typeof fetch

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/marketvision/brand-intelligence/job/job-1'),
      { params: Promise.resolve({ jobId: 'job-1' }) },
    )

    expect(response.status).toBe(502)
  })
})
