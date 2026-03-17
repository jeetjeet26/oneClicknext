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

describe('Gmail thread lifecycle repair route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-20T12:00:00.000Z'))
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthorized', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/email/threads/repair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        propertyId: 'property-1',
        action: 'resolve_overdue_internal_replies',
      }),
    }) as NextRequest

    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it('resolves overdue awaiting-internal-reply threads in bulk', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId: 'org-1' })

    const threadUpdateIn = vi.fn().mockResolvedValue({ error: null })
    const leadActivityInsert = vi.fn().mockResolvedValue({ error: null })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_configurations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'config-1' },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'email_threads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn().mockResolvedValue({
                      data: [
                        {
                          id: 'thread-overdue',
                          lead_id: 'lead-1',
                          last_message_at: '2026-03-15T08:00:00.000Z',
                        },
                        {
                          id: 'thread-fresh',
                          lead_id: 'lead-2',
                          last_message_at: '2026-03-20T11:30:00.000Z',
                        },
                      ],
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
            update: vi.fn((payload: unknown) => {
              expect(payload).toEqual({ status: 'resolved' })
              return {
                in: threadUpdateIn,
              }
            }),
          }
        }

        if (table === 'lead_activities') {
          return {
            insert: leadActivityInsert,
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/email/threads/repair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        propertyId: 'property-1',
        action: 'resolve_overdue_internal_replies',
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      success: true,
      scanned: 2,
      repaired: 1,
      repairedThreadIds: ['thread-overdue'],
    })
    expect(threadUpdateIn).toHaveBeenCalledWith('id', ['thread-overdue'])
    expect(leadActivityInsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          lead_id: 'lead-1',
          type: 'email_thread_status_updated',
        }),
      ])
    )
  })
})
