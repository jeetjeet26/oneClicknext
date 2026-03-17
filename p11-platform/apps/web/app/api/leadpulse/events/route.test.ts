import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const rpcMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

function makeSingleResult(data: unknown, error: unknown = null) {
  return {
    data,
    error,
  }
}

describe('LeadPulse events route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    createClientMock.mockResolvedValue({
      auth: {
        getUser: authGetUserMock,
      },
      from: vi.fn((table: string) => {
        if (table === 'lead_engagement_events') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'event-1',
                        event_type: 'tour_scheduled',
                        metadata: { foo: 'bar' },
                        score_weight: 25,
                        created_at: '2026-03-12T10:00:00.000Z',
                      },
                    ],
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

    rpcMock.mockResolvedValue({ data: 'score-1', error: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 400 for invalid event types', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/leadpulse/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        leadId: 'lead-1',
        eventType: 'not_real',
      }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid eventType' })
  })

  it('records an event and triggers rescoring', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue(
                  makeSingleResult({
                    id: 'lead-1',
                    property_id: 'property-1',
                  })
                ),
              })),
            })),
          }
        }

        if (table === 'lead_engagement_events') {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue(
                  makeSingleResult({
                    id: 'event-1',
                    lead_id: 'lead-1',
                    event_type: 'tour_scheduled',
                    score_weight: 25,
                    created_at: '2026-03-12T10:00:00.000Z',
                  })
                ),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
      rpc: rpcMock,
    })

    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/leadpulse/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        leadId: 'lead-1',
        eventType: 'tour_scheduled',
        metadata: { source: 'widget' },
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toEqual({
      success: true,
      event: {
        id: 'event-1',
        leadId: 'lead-1',
        eventType: 'tour_scheduled',
        scoreWeight: 25,
        createdAt: '2026-03-12T10:00:00.000Z',
      },
      rescored: true,
    })
    expect(validatePropertyAccessMock).toHaveBeenCalledWith(
      'user-1',
      'property-1'
    )
    expect(rpcMock).toHaveBeenCalledWith('score_lead', {
      p_lead_id: 'lead-1',
    })
  })

  it('returns events for an authorized lead', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue(
                  makeSingleResult({
                    property_id: 'property-1',
                  })
                ),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
      rpc: rpcMock,
    })

    const { GET } = await import('./route')

    const request = new Request(
      'http://localhost/api/leadpulse/events?leadId=lead-1&limit=10',
      { method: 'GET' }
    ) as NextRequest & { nextUrl: NextRequest['nextUrl'] }
    request.nextUrl = new URL(request.url) as unknown as NextRequest['nextUrl']

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({
      events: [
        {
          id: 'event-1',
          eventType: 'tour_scheduled',
          metadata: { foo: 'bar' },
          scoreWeight: 25,
          createdAt: '2026-03-12T10:00:00.000Z',
        },
      ],
    })
  })
})
