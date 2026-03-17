import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createServiceClientMock = vi.fn()
const getRateLimitKeyMock = vi.fn()
const rateLimitHeadersMock = vi.fn()
const leadLimiterCheckMock = vi.fn()
const validateBodyMock = vi.fn()
const auditLogMock = vi.fn()
const getRequestIpMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/rate-limiter', () => ({
  leadLimiter: {
    check: leadLimiterCheckMock,
  },
  getRateLimitKey: getRateLimitKeyMock,
  rateLimitHeaders: rateLimitHeadersMock,
}))

vi.mock('@/utils/services/validation', () => ({
  validateBody: validateBodyMock,
  leadCaptureSchema: {},
}))

vi.mock('@/utils/services/audit-logger', () => ({
  auditLog: auditLogMock,
  getRequestIp: getRequestIpMock,
}))

describe('Luma lead capture route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRateLimitKeyMock.mockReturnValue('lead-key')
    leadLimiterCheckMock.mockReturnValue({
      allowed: true,
      remaining: 14,
      resetAt: Date.now() + 60_000,
    })
    rateLimitHeadersMock.mockReturnValue({})
    auditLogMock.mockImplementation(() => {})
    getRequestIpMock.mockReturnValue('127.0.0.1')
    validateBodyMock.mockReturnValue({
      success: true,
      data: {
        leadInfo: {
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          phone: '5551112222',
        },
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when the api key is missing', async () => {
    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/lumaleasing/lead', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'API key required' })
  })

  it('creates a new lead for a valid request', async () => {
    const leadInsertSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'lead-1' },
      error: null,
    })
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: { property_id: 'property-1' },
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                })),
              })),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: leadInsertSingleMock,
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        }

        if (table === 'lead_activities') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    gte: vi.fn(() => ({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: null,
                        error: null,
                      }),
                    })),
                  })),
                })),
              })),
            })),
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/lumaleasing/lead', {
      method: 'POST',
      headers: {
        'x-api-key': 'test-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        leadInfo: {
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          phone: '5551112222',
        },
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toEqual({
      success: true,
      leadId: 'lead-1',
      message: "Thanks, Jane! We've saved your information and will be in touch soon.",
    })
    expect(leadInsertSingleMock).toHaveBeenCalled()
    expect(auditLogMock).toHaveBeenCalled()
  })

  it('reuses an existing phone-only lead on retry instead of creating a duplicate', async () => {
    validateBodyMock.mockReturnValue({
      success: true,
      data: {
        leadInfo: {
          first_name: 'Jane',
          last_name: 'Doe',
          phone: '5551112222',
        },
      },
    })

    const leadsUpdateEqMock = vi.fn().mockResolvedValue({ error: null })
    const leadsInsertMock = vi.fn()
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: { property_id: 'property-1' },
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({ data: [{ id: 'lead-existing' }], error: null }),
                })),
              })),
            })),
            insert: leadsInsertMock,
            update: vi.fn(() => ({
              eq: leadsUpdateEqMock,
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/lead', {
      method: 'POST',
      headers: {
        'x-api-key': 'test-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        leadInfo: {
          first_name: 'Jane',
          last_name: 'Doe',
          phone: '5551112222',
        },
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({
      success: true,
      leadId: 'lead-existing',
      message: "Thanks, Jane! We've saved your information and will be in touch soon.",
    })
    expect(leadsInsertMock).not.toHaveBeenCalled()
    expect(leadsUpdateEqMock).toHaveBeenCalledWith('id', 'lead-existing')
  })

  it('skips duplicate widget note activity on rapid retry', async () => {
    validateBodyMock.mockReturnValue({
      success: true,
      data: {
        leadInfo: {
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          phone: '5551112222',
          notes: 'Need top-floor unit',
          moveInDate: '2026-04-01',
          bedroomPreference: '2',
        },
      },
    })

    const leadActivitiesInsertMock = vi.fn().mockResolvedValue({ error: null })
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: { property_id: 'property-1' },
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({
                    data: [{ id: 'lead-1' }],
                    error: null,
                  }),
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        }

        if (table === 'lead_activities') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    gte: vi.fn(() => ({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: { id: 'activity-1' },
                        error: null,
                      }),
                    })),
                  })),
                })),
              })),
            })),
            insert: leadActivitiesInsertMock,
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/lead', {
      method: 'POST',
      headers: {
        'x-api-key': 'test-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        leadInfo: {
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          phone: '5551112222',
          notes: 'Need top-floor unit',
          moveInDate: '2026-04-01',
          bedroomPreference: '2',
        },
      }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(leadActivitiesInsertMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the session id does not belong to the property', async () => {
    validateBodyMock.mockReturnValue({
      success: true,
      data: {
        leadInfo: {
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          phone: '5551112222',
        },
        sessionId: 'foreign-session',
      },
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: { property_id: 'property-1' },
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'widget_sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/lead', {
      method: 'POST',
      headers: {
        'x-api-key': 'test-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        leadInfo: {
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          phone: '5551112222',
        },
        sessionId: 'foreign-session',
      }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid sessionId for this property',
    })
  })
})
