import { beforeEach, describe, expect, it, vi } from 'vitest'
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

vi.mock('@/utils/propertyaudit/openai-connector', () => ({
  OpenAIConnector: class OpenAIConnector {},
}))

vi.mock('@/utils/propertyaudit/claude-connector', () => ({
  ClaudeConnector: class ClaudeConnector {},
}))

vi.mock('@/utils/propertyaudit/openai-natural-connector', () => ({
  OpenAINaturalConnector: class OpenAINaturalConnector {},
}))

vi.mock('@/utils/propertyaudit/claude-natural-connector', () => ({
  ClaudeNaturalConnector: class ClaudeNaturalConnector {},
}))

describe('propertyaudit process route auth', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('returns 401 when caller is neither cron-authenticated nor signed in', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/process', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'run-1' }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('returns 403 for signed-in user without access to run property', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
      error: 'Forbidden',
    })

    const geoRunsSingle = vi.fn().mockResolvedValue({
      data: { id: 'run-1', property_id: 'property-1', status: 'queued' },
      error: null,
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'geo_runs') {
          throw new Error(`Unexpected table ${table}`)
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: geoRunsSingle,
            })),
          })),
        }
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/process', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'run-1' }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('accepts valid cron auth and proceeds past auth checks', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const geoRunsSingle = vi.fn()
      .mockResolvedValueOnce({
        data: { id: 'run-1', property_id: 'property-1', status: 'running' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { status: 'running' },
        error: null,
      })
    const claimMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'geo_runs') {
          throw new Error(`Unexpected table ${table}`)
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: geoRunsSingle,
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  maybeSingle: claimMaybeSingle,
                })),
              })),
            })),
          })),
        }
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/process', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer cron-secret',
      },
      body: JSON.stringify({ runId: 'run-1' }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Run already started or finished',
      currentStatus: 'running',
    })
  })

  it('returns 409 when another processor claims the queued run first', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
    })

    const runSelectSingle = vi.fn()
      .mockResolvedValueOnce({
        data: { id: 'run-1', property_id: 'property-1', status: 'queued' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { status: 'running' },
        error: null,
      })

    const claimMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'geo_runs') {
          throw new Error(`Unexpected table ${table}`)
        }

        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: runSelectSingle,
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  maybeSingle: claimMaybeSingle,
                })),
              })),
            })),
          })),
        }
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/process', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'run-1' }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Run already started or finished',
      currentStatus: 'running',
    })
  })

  it('marks the run failed when an unexpected error happens after claiming it', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
    })

    const geoRunsUpdateEqMock = vi.fn().mockReturnValue(Promise.resolve({ error: null }))
    const geoRunsUpdateClaimSelectMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'run-1',
        property_id: 'property-1',
        status: 'running',
        surface: 'openai',
      },
      error: null,
    })
    const geoRunsSelectSingle = vi.fn().mockResolvedValue({
      data: { id: 'run-1', property_id: 'property-1', status: 'queued' },
      error: null,
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'geo_runs') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: geoRunsSelectSingle,
              })),
            })),
            update: vi.fn((payload?: Record<string, unknown>) => {
              if (payload?.status === 'running') {
                return {
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      select: vi.fn(() => ({
                        maybeSingle: geoRunsUpdateClaimSelectMaybeSingle,
                      })),
                    })),
                  })),
                }
              }

              return {
                eq: geoRunsUpdateEqMock,
              }
            }),
          }
        }

        if (table === 'geo_queries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({
                  data: [{ id: 'query-1', text: 'best apartments', run_count: 1 }],
                  error: null,
                }),
              })),
            })),
          }
        }

        if (table === 'properties') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockRejectedValue(new Error('property lookup exploded')),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/process', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'run-1' }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' })
    expect(geoRunsUpdateEqMock).toHaveBeenCalledWith('id', 'run-1')
  })

  it('creates missing property config idempotently before processing a run', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
    })

    const geoRunsUpdateClaimSelectMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'run-1',
        property_id: 'property-1',
        status: 'running',
        surface: 'google_ai',
        execution_count: 1,
      },
      error: null,
    })
    const geoRunsSelectSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'run-1',
        property_id: 'property-1',
        status: 'queued',
        surface: 'google_ai',
      },
      error: null,
    })
    const propertyConfigMaybeSingle = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: { domains: ['amli.com'], competitor_domains: [] },
        error: null,
      })
    const propertyConfigUpsert = vi.fn().mockResolvedValue({ error: null })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'geo_runs') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: geoRunsSelectSingle,
              })),
            })),
            update: vi.fn((payload?: Record<string, unknown>) => {
              if (payload?.status === 'running') {
                return {
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      select: vi.fn(() => ({
                        maybeSingle: geoRunsUpdateClaimSelectMaybeSingle,
                      })),
                    })),
                  })),
                }
              }

              return {
                eq: vi.fn().mockResolvedValue({ error: null }),
              }
            }),
          }
        }

        if (table === 'geo_queries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({
                  data: [{ id: 'query-1', text: 'best apartments in Austin' }],
                  error: null,
                }),
              })),
            })),
          }
        }

        if (table === 'properties') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    name: 'AMLI Austin',
                    address: { city: 'Austin', state: 'TX' },
                    website_url: 'https://amli.com',
                  },
                  error: null,
                }),
              })),
            })),
          }
        }

        if (table === 'geo_property_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: propertyConfigMaybeSingle,
              })),
            })),
            upsert: propertyConfigUpsert,
          }
        }

        if (table === 'geo_answers') {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'answer-1' },
                  error: null,
                }),
              })),
            })),
          }
        }

        if (table === 'geo_citations' || table === 'geo_scores') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/propertyaudit/process', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-propertyaudit-local-fixture': '1',
      },
      body: JSON.stringify({ runId: 'run-1' }),
    }) as NextRequest

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(expect.objectContaining({
      success: true,
      runId: 'run-1',
      processed: 1,
    }))
    expect(propertyConfigMaybeSingle).toHaveBeenCalledTimes(2)
    expect(propertyConfigUpsert).toHaveBeenCalledWith(
      {
        property_id: 'property-1',
        domains: ['amli.com'],
        competitor_domains: [],
        is_active: true,
      },
      {
        onConflict: 'property_id',
        ignoreDuplicates: true,
      }
    )
  })
})
