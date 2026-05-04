import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

describe('propertyaudit run route', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('POST returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'property-1' }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('POST returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
      error: 'Forbidden',
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'property-1' }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('POST returns 500 when data-engine dispatch is explicitly disabled', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    process.env.PROPERTYAUDIT_USE_DATA_ENGINE = 'false'

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'geo_queries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({ count: 2 }),
              })),
            })),
          }
        }
        if (table === 'geo_runs') {
          throw new Error('geo_runs should not be inserted when data-engine is explicitly disabled')
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'property-1', surfaces: ['openai'] }),
    }) as NextRequest
    Object.defineProperty(request, 'nextUrl', {
      value: new URL('http://localhost/api/propertyaudit/run'),
      configurable: true,
    })

    const response = await POST(request)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'PropertyAudit requires data-engine dispatch. Set PROPERTYAUDIT_USE_DATA_ENGINE=true or remove the explicit false override.',
    })
  })

  it('PATCH returns 403 when run belongs to unauthorized property', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
      error: 'Forbidden',
    })

    const geoRunsSelectSingle = vi.fn().mockResolvedValue({
      data: { id: 'run-1', property_id: 'property-1' },
      error: null,
    })
    const geoRunsUpdateSelectSingle = vi.fn()

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'geo_runs') {
          throw new Error(`Unexpected table ${table}`)
        }

        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: geoRunsSelectSingle,
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: geoRunsUpdateSelectSingle,
              })),
            })),
          })),
        }
      }),
    })

    const { PATCH } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/run', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'run-1', status: 'completed' }),
    }) as NextRequest

    const response = await PATCH(request)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(geoRunsUpdateSelectSingle).not.toHaveBeenCalled()
  })

  it('POST marks the run failed when data-engine dispatch fails and fallback is not enabled', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    process.env.PROPERTYAUDIT_USE_DATA_ENGINE = 'true'
    process.env.CRON_SECRET = 'cron-secret'
    process.env.DATA_ENGINE_URL = 'http://data-engine.local'
    process.env.DATA_ENGINE_API_KEY = 'data-engine-key'

    const geoRunsInsertSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'run-1',
        property_id: 'property-1',
        surface: 'openai',
        model_name: 'gpt-5.2',
        status: 'queued',
        query_count: 2,
        started_at: '2026-03-16T18:00:00.000Z',
        finished_at: null,
        error_message: null,
      },
      error: null,
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'geo_queries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({ count: 2 }),
              })),
            })),
          }
        }

        if (table === 'geo_runs') {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: geoRunsInsertSingle,
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ error: null })),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.startsWith('http://data-engine.local/jobs/propertyaudit/run')) {
        throw new Error('connect ECONNREFUSED')
      }

      throw new Error(`Unexpected fetch URL ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'property-1', surfaces: ['openai'] }),
    }) as NextRequest

    const response = await POST(request)
    const body = await response.json()
    await Promise.resolve()
    await Promise.resolve()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      processorMode: 'data_engine',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://data-engine.local/jobs/propertyaudit/run')
  })

  it('POST dispatches the default four-surface PropertyAudit batch to data-engine', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    process.env.PROPERTYAUDIT_USE_DATA_ENGINE = 'true'
    process.env.DATA_ENGINE_URL = 'http://data-engine.local'
    process.env.DATA_ENGINE_API_KEY = 'data-engine-key'
    delete process.env.CRON_SECRET

    let inserted = 0
    const geoRunsInsert = vi.fn((payload: {
      surface: string
      model_name: string
      query_count: number
    }) => {
      inserted += 1
      return {
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: `run-${inserted}`,
              property_id: 'property-1',
              surface: payload.surface,
              model_name: payload.model_name,
              status: 'queued',
              query_count: payload.query_count,
              started_at: '2026-03-16T18:00:00.000Z',
              finished_at: null,
              error_message: null,
            },
            error: null,
          }),
        })),
      }
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'geo_queries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({ count: 24 }),
              })),
            })),
          }
        }

        if (table === 'geo_runs') {
          return {
            insert: geoRunsInsert,
            update: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ error: null })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('http://data-engine.local/jobs/propertyaudit/run')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected fetch URL ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'property-1' }),
    }) as NextRequest

    const response = await POST(request)
    const body = await response.json()
    await Promise.resolve()
    await Promise.resolve()

    expect(response.status).toBe(200)
    expect(body.processorMode).toBe('data_engine')
    expect((body.runs as Array<{ surface: string }>).map((run) => run.surface)).toEqual([
      'chatgpt',
      'gemini',
      'perplexity',
      'google_ai',
    ])
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(geoRunsInsert).toHaveBeenCalledWith(expect.objectContaining({
      measurement_mode: 'natural',
      prompt_source: 'generated',
      access_mode: 'URLOnly',
    }))
  })

  it('POST keeps normal audits on data-engine dispatch even when the worker request fails', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    process.env.PROPERTYAUDIT_USE_DATA_ENGINE = 'true'
    process.env.CRON_SECRET = 'cron-secret'
    process.env.DATA_ENGINE_URL = 'http://data-engine.local'
    process.env.DATA_ENGINE_API_KEY = 'data-engine-key'

    const geoRunsInsertSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'run-1',
        property_id: 'property-1',
        surface: 'openai',
        model_name: 'gpt-5.2',
        status: 'queued',
        query_count: 2,
        started_at: '2026-03-16T18:00:00.000Z',
        finished_at: null,
        error_message: null,
      },
      error: null,
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'geo_queries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({ count: 2 }),
              })),
            })),
          }
        }

        if (table === 'geo_runs') {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: geoRunsInsertSingle,
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ error: null })),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.startsWith('http://data-engine.local/jobs/propertyaudit/run')) {
        throw new Error('connect ECONNREFUSED')
      }

      throw new Error(`Unexpected fetch URL ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'property-1', surfaces: ['openai'] }),
    }) as NextRequest

    const response = await POST(request)
    const body = await response.json()
    await Promise.resolve()
    await Promise.resolve()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      processorMode: 'data_engine',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://data-engine.local/jobs/propertyaudit/run')
  })

  it('POST treats data-engine claim conflicts as idempotent dispatch success', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    process.env.PROPERTYAUDIT_USE_DATA_ENGINE = 'true'
    process.env.CRON_SECRET = 'cron-secret'
    process.env.DATA_ENGINE_URL = 'http://data-engine.local'
    process.env.DATA_ENGINE_API_KEY = 'data-engine-key'

    const geoRunsInsertSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'run-1',
        property_id: 'property-1',
        surface: 'openai',
        model_name: 'gpt-5.2',
        status: 'queued',
        query_count: 2,
        started_at: '2026-03-16T18:00:00.000Z',
        finished_at: null,
        error_message: null,
      },
      error: null,
    })
    const geoRunsUpdateEqEq = vi.fn(() => Promise.resolve({ error: null }))

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'geo_queries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({ count: 2 }),
              })),
            })),
          }
        }

        if (table === 'geo_runs') {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: geoRunsInsertSingle,
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: geoRunsUpdateEqEq,
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('http://data-engine.local/jobs/propertyaudit/run')) {
        return new Response(
          JSON.stringify({ detail: 'Run run-1 is not queued (status=running)' }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        )
      }

      throw new Error(`Unexpected fetch URL ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'property-1', surfaces: ['openai'] }),
    }) as NextRequest

    const response = await POST(request)
    const body = await response.json()
    await Promise.resolve()
    await Promise.resolve()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      processorMode: 'data_engine',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(geoRunsUpdateEqEq).not.toHaveBeenCalled()
  })

  it('POST can force deterministic local fixture processing', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    process.env.PROPERTYAUDIT_USE_DATA_ENGINE = 'true'
    process.env.CRON_SECRET = 'cron-secret'
    process.env.DATA_ENGINE_URL = 'http://data-engine.local'
    process.env.DATA_ENGINE_API_KEY = 'data-engine-key'

    const geoRunsInsertSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'run-1',
        property_id: 'property-1',
        surface: 'openai',
        model_name: 'gpt-5.2',
        status: 'queued',
        query_count: 2,
        started_at: '2026-03-16T18:00:00.000Z',
        finished_at: null,
        error_message: null,
      },
      error: null,
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'geo_queries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({ count: 2 }),
              })),
            })),
          }
        }

        if (table === 'geo_runs') {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: geoRunsInsertSingle,
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ error: null })),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('http://localhost/api/propertyaudit/process')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected fetch URL ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'property-1', surfaces: ['openai'], useLocalFixture: true }),
    }) as NextRequest

    const response = await POST(request)
    const body = await response.json()
    await Promise.resolve()
    await Promise.resolve()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      processorMode: 'typescript_fixture',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost/api/propertyaudit/process')
    const init = fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined
    expect(init?.headers?.['X-PropertyAudit-Local-Fixture']).toBe('1')
  })
})
