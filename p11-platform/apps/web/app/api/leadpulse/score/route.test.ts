import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const serviceRpcMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

describe('LeadPulse score route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn(),
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthorized', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: new Error('Unauthorized'),
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/leadpulse/score?leadId=lead-1'
    ) as NextRequest & { nextUrl: NextRequest['nextUrl'] }
    request.nextUrl = new URL(request.url) as unknown as NextRequest['nextUrl']

    const response = await GET(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('counts rpc responses with embedded errors as failed in leadIds batch scoring', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    serviceRpcMock
      .mockResolvedValueOnce({ data: 'score-1', error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'scoring failed' } })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({
                data: [
                  { id: 'lead-1', property_id: 'property-1' },
                  { id: 'lead-2', property_id: 'property-1' },
                ],
                error: null,
              }),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
      rpc: serviceRpcMock,
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/leadpulse/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        leadIds: ['lead-1', 'lead-2'],
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toEqual({
      success: true,
      processed: 2,
      successful: 1,
      failed: 1,
    })
  })

  it('returns score with workflow outcome explanations for a lead', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
        if (table === 'lead_scores') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: 'score-1',
                        lead_id: 'lead-1',
                        total_score: 72,
                        engagement_score: 76,
                        timing_score: 69,
                        source_score: 64,
                        completeness_score: 70,
                        behavior_score: 68,
                        score_bucket: 'warm',
                        factors: [{ factor: 'Recent inquiry', impact: '+8', type: 'positive' }],
                        scored_at: '2026-03-16T15:00:00.000Z',
                        model_version: 'v1',
                      },
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { property_id: 'property-1' },
                  error: null,
                }),
              })),
            })),
          }
        }

        if (table === 'lead_workflows') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        status: 'active',
                        next_action_at: '2026-03-16T16:00:00.000Z',
                        last_action_at: '2026-03-16T15:00:00.000Z',
                        workflow: {
                          steps: [{ id: 0 }, { id: 1 }, { id: 2 }],
                        },
                        actions: [
                          { step_number: 0, status: 'sent', created_at: '2026-03-16T15:00:00.000Z' },
                          { step_number: 1, status: 'failed', created_at: '2026-03-16T15:01:00.000Z' },
                          { step_number: 1, status: 'sent', created_at: '2026-03-16T15:03:00.000Z' },
                        ],
                      },
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/leadpulse/score?leadId=lead-1'
    ) as NextRequest & { nextUrl: NextRequest['nextUrl'] }
    request.nextUrl = new URL(request.url) as unknown as NextRequest['nextUrl']

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.score.workflowOutcomes).toEqual({
      workflowStatus: 'active',
      pending: 1,
      sent: 2,
      skipped: 0,
      failed: 0,
      retried: 1,
      nextActionAt: '2026-03-16T16:00:00.000Z',
      lastActionAt: '2026-03-16T15:00:00.000Z',
    })
    expect(json.score.factors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          factor: 'Workflow retry pressure',
          type: 'neutral',
        }),
        expect.objectContaining({
          factor: 'Workflow progression',
          type: 'positive',
        }),
        expect.objectContaining({
          factor: 'Pending workflow actions',
          type: 'neutral',
        }),
      ])
    )
  })

  it('counts rpc responses with embedded errors as failed in property batch scoring', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    serviceRpcMock
      .mockResolvedValueOnce({ data: 'score-1', error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'scoring failed' } })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({
                    data: [{ id: 'lead-1' }, { id: 'lead-2' }],
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
      rpc: serviceRpcMock,
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/leadpulse/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        propertyId: 'property-1',
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toEqual({
      success: true,
      processed: 2,
      successful: 1,
      failed: 1,
    })
  })
})
