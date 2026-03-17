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

describe('Gmail status route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-12T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('returns 401 when unauthorized', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/email/status?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when the user cannot access the property', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/email/status?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(403)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns disconnected when no Gmail configuration exists', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    createServiceClientMock.mockReturnValue({
      from: vi.fn(() => ({
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
      })),
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/email/status?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toMatchObject({
      connected: false,
      message: 'Gmail not connected',
      webhook_capability: {
        mode: 'unconfigured',
        ready: false,
        blockers: ['missing_email_connection'],
      },
    })
  })

  it('returns status metadata for a connected account', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    const emailThreadsSelect = vi
      .fn()
      .mockReturnValueOnce({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  status: 'awaiting_internal_reply',
                  last_message_at: '2026-03-09T00:06:00.000Z',
                },
                {
                  status: 'awaiting_lead_reply',
                  last_message_at: '2026-03-10T00:04:00.000Z',
                },
                {
                  status: 'active',
                  last_message_at: '2026-03-10T00:03:00.000Z',
                },
                {
                  status: 'something_custom',
                  last_message_at: '2026-03-10T00:01:00.000Z',
                },
              ],
              error: null,
            }),
          })),
        })),
      })
      .mockReturnValueOnce({
        eq: vi.fn(() => ({
          in: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'thread-1',
                    status: 'awaiting_internal_reply',
                    subject: 'Tour follow-up',
                    last_message_at: '2026-03-09T00:06:00.000Z',
                    message_count: 4,
                    lead_id: 'lead-1',
                  },
                ],
                error: null,
              }),
            })),
          })),
        })),
      })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_configurations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'config-1',
                      google_email: 'leasing@example.com',
                      token_status: 'healthy',
                      last_health_check_at: '2026-03-10T00:00:00.000Z',
                      last_sync_at: '2026-03-10T00:05:00.000Z',
                      sync_enabled: true,
                      auto_reply_enabled: false,
                      history_id: '101',
                      watch_expiration: '2026-03-12T14:00:00.000Z',
                    },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'email_threads') {
          return {
            select: emailThreadsSelect,
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/email/status?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toMatchObject({
      connected: true,
      email: 'leasing@example.com',
      token_status: 'healthy',
      sync_enabled: true,
      auto_reply_enabled: false,
      webhook_capability: {
        mode: 'push_watch',
        ready: true,
        blockers: [],
        history_id: '101',
        watch_expires_at: '2026-03-12T14:00:00.000Z',
        watch_ttl_minutes: 120,
      },
      thread_lifecycle: {
        total_threads: 4,
        awaiting_internal_reply: 1,
        awaiting_internal_reply_overdue: 1,
        awaiting_lead_reply: 1,
        active: 1,
        other: 1,
        latest_thread_activity_at: '2026-03-09T00:06:00.000Z',
      },
      pending_threads_preview: [
        {
          id: 'thread-1',
          status: 'awaiting_internal_reply',
          subject: 'Tour follow-up',
          last_message_at: '2026-03-09T00:06:00.000Z',
          message_count: 4,
          lead_id: 'lead-1',
          overdue: true,
          overdue_days: 3,
        },
      ],
    })
  })
})
