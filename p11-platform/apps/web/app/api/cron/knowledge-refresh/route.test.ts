import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createAdminClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const startCronJobRunMock = vi.fn()
const finishCronJobRunMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/cron-job-runs', () => ({
  startCronJobRun: startCronJobRunMock,
  finishCronJobRun: finishCronJobRunMock,
}))

describe('GET/POST /api/cron/knowledge-refresh', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    startCronJobRunMock.mockResolvedValue({
      id: 'run-1',
      jobName: 'knowledge-refresh',
      startedAtMs: 0,
    })
    finishCronJobRunMock.mockResolvedValue(undefined)
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('returns 401 when cron auth is invalid', async () => {
    process.env.CRON_SECRET = 'expected-secret'

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/knowledge-refresh', {
      method: 'GET',
      headers: {
        authorization: 'Bearer wrong-secret',
      },
    }) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })

  it('returns success when there are no stale knowledge sources', async () => {
    process.env.CRON_SECRET = 'expected-secret'
    process.env.INTERNAL_API_KEY = 'internal-secret'
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            or: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            })),
          })),
        })),
      })),
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/knowledge-refresh', {
      method: 'GET',
      headers: {
        authorization: 'Bearer expected-secret',
      },
    }) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: 'No stale knowledge sources to refresh',
      processed: 0,
    })
  })

  it('returns 500 when INTERNAL_API_KEY is missing for cron refresh', async () => {
    process.env.CRON_SECRET = 'expected-secret'
    delete process.env.INTERNAL_API_KEY

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/knowledge-refresh', {
      method: 'GET',
      headers: {
        authorization: 'Bearer expected-secret',
      },
    }) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'INTERNAL_API_KEY is required for knowledge refresh',
    })
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })

  it('returns 401 for manual property refresh when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/cron/knowledge-refresh', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ propertyId: 'property-1' }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 for manual property refresh when access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
      error: 'Forbidden',
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/cron/knowledge-refresh', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ propertyId: 'property-1' }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })

  it('uses ingested_urls provenance for manual refresh when source_url is absent', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const sourceSingleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'source-1',
        source_url: null,
        extracted_data: {
          ingested_urls: ['https://example.com', 'https://example.com/floorplans'],
        },
      },
      error: null,
    })
    const updateEqMock = vi.fn().mockResolvedValue({ error: null })
    const fromMock = vi.fn((table: string) => {
      if (table !== 'knowledge_sources') {
        throw new Error(`Unexpected table ${table}`)
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: sourceSingleMock,
            })),
          })),
        })),
        update: vi.fn(() => ({
          eq: updateEqMock,
        })),
      }
    })
    createAdminClientMock.mockReturnValue({ from: fromMock })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ success: true, documentsCreated: 2 }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/cron/knowledge-refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ propertyId: 'property-1' }),
      }) as NextRequest
    )

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const fetchCall = fetchMock.mock.calls[0]
    const body = JSON.parse(String(fetchCall[1]?.body || '{}'))
    expect(body.urls).toEqual(['https://example.com', 'https://example.com/floorplans'])
    expect(updateEqMock).toHaveBeenCalledWith('id', 'source-1')
  })
})
