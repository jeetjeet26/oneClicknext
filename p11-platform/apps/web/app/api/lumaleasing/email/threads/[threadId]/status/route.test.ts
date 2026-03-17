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

function makeRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/lumaleasing/email/threads/thread-1/status', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }) as NextRequest
}

describe('Gmail thread status update route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthorized', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { POST } = await import('./route')
    const response = await POST(makeRequest({ status: 'resolved' }), {
      params: Promise.resolve({ threadId: 'thread-1' }),
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 404 when thread is not found', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_threads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const response = await POST(makeRequest({ status: 'resolved' }), {
      params: Promise.resolve({ threadId: 'thread-1' }),
    })

    expect(response.status).toBe(404)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Email thread not found' })
  })

  it('returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_threads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'thread-1',
                    property_id: 'property-1',
                    lead_id: 'lead-1',
                    status: 'awaiting_internal_reply',
                  },
                  error: null,
                }),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const response = await POST(makeRequest({ status: 'resolved' }), {
      params: Promise.resolve({ threadId: 'thread-1' }),
    })

    expect(response.status).toBe(403)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns noChange when status already matches', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })

    const threadUpdateEq = vi.fn()
    const leadActivityInsert = vi.fn()
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_threads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'thread-1',
                    property_id: 'property-1',
                    lead_id: 'lead-1',
                    status: 'awaiting_internal_reply',
                  },
                  error: null,
                }),
              })),
            })),
            update: vi.fn(() => ({
              eq: threadUpdateEq,
            })),
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
    const response = await POST(
      makeRequest({ status: 'awaiting_internal_reply' }),
      {
        params: Promise.resolve({ threadId: 'thread-1' }),
      }
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toEqual({
      success: true,
      threadId: 'thread-1',
      status: 'awaiting_internal_reply',
      previousStatus: 'awaiting_internal_reply',
      noChange: true,
    })
    expect(threadUpdateEq).not.toHaveBeenCalled()
    expect(leadActivityInsert).not.toHaveBeenCalled()
  })

  it('updates status and logs lead activity when changed', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })

    const threadUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const leadActivityInsert = vi.fn().mockResolvedValue({ error: null })
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_threads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'thread-1',
                    property_id: 'property-1',
                    lead_id: 'lead-1',
                    status: 'awaiting_internal_reply',
                  },
                  error: null,
                }),
              })),
            })),
            update: vi.fn((payload: unknown) => {
              expect(payload).toEqual({ status: 'resolved' })
              return {
                eq: threadUpdateEq,
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
    const response = await POST(makeRequest({ status: 'resolved' }), {
      params: Promise.resolve({ threadId: 'thread-1' }),
    })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toEqual({
      success: true,
      threadId: 'thread-1',
      previousStatus: 'awaiting_internal_reply',
      status: 'resolved',
      noChange: false,
    })
    expect(threadUpdateEq).toHaveBeenCalledWith('id', 'thread-1')
    expect(leadActivityInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_id: 'lead-1',
        type: 'email_thread_status_updated',
      })
    )
  })
})
