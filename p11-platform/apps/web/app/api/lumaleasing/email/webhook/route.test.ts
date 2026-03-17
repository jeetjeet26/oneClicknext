import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createServiceClientMock = vi.fn()
const syncInboxMock = vi.fn()
const getRateLimitKeyMock = vi.fn()
const rateLimitHeadersMock = vi.fn()
const webhookLimiterCheckMock = vi.fn()
const validateBodyMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/gmail-service', () => ({
  syncInbox: syncInboxMock,
}))

vi.mock('@/utils/services/rate-limiter', () => ({
  webhookLimiter: {
    check: webhookLimiterCheckMock,
  },
  getRateLimitKey: getRateLimitKeyMock,
  rateLimitHeaders: rateLimitHeadersMock,
}))

vi.mock('@/utils/services/validation', () => ({
  validateBody: validateBodyMock,
  gmailWebhookSchema: {},
}))

describe('Gmail webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    getRateLimitKeyMock.mockReturnValue('gmail-webhook-key')
    webhookLimiterCheckMock.mockReturnValue({
      allowed: true,
      remaining: 29,
      resetAt: Date.now() + 60_000,
    })
    rateLimitHeadersMock.mockReturnValue({})
    validateBodyMock.mockImplementation((body: unknown) => ({
      success: true,
      data: body,
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('acknowledges missing message data with 200', async () => {
    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/email/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ success: true })
  })

  it('returns 429 when the webhook is rate limited', async () => {
    webhookLimiterCheckMock.mockReturnValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      retryAfterMs: 60_000,
    })
    rateLimitHeadersMock.mockReturnValue({ 'Retry-After': '60' })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/email/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    await expect(response.json()).resolves.toEqual({
      error: 'Too many requests. Please try again later.',
    })
  })

  it('acknowledges invalid webhook bodies with 200', async () => {
    validateBodyMock.mockReturnValue({
      success: false,
      error: 'message.data: Required',
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/email/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ invalid: true }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(syncInboxMock).not.toHaveBeenCalled()
  })

  it('acknowledges when no email configuration matches the mailbox', async () => {
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_configurations') {
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
    const payload = Buffer.from(
      JSON.stringify({
        emailAddress: 'leasing@example.com',
        historyId: 'history-1',
      }),
      'utf-8'
    ).toString('base64')
    const request = new Request('http://localhost/api/lumaleasing/email/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          data: payload,
          messageId: 'pubsub-1',
          publishTime: '2026-03-10T00:00:00.000Z',
        },
        subscription: 'sub-1',
      }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ success: true })
  })

  it('processes inbound mail and stores schema-aligned thread/message records', async () => {
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
                      property_id: 'property-1',
                      profile_id: 'profile-1',
                      google_email: 'leasing@example.com',
                      access_token: 'access-token',
                      refresh_token: 'refresh-token',
                      token_expires_at: '2026-03-11T00:00:00.000Z',
                      sync_enabled: true,
                      auto_reply_enabled: false,
                      signature_template: null,
                      token_status: 'healthy',
                      last_sync_at: null,
                      history_id: null,
                      watch_expiration: null,
                    },
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
    syncInboxMock.mockResolvedValue({
      newMessages: 1,
      updatedThreads: 1,
    })

    const { POST } = await import('./route')
    const payload = Buffer.from(
      JSON.stringify({
        emailAddress: 'leasing@example.com',
        historyId: 'history-1',
      }),
      'utf-8'
    ).toString('base64')
    const request = new Request('http://localhost/api/lumaleasing/email/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          data: payload,
          messageId: 'pubsub-1',
          publishTime: '2026-03-10T00:00:00.000Z',
        },
        subscription: 'sub-1',
      }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(syncInboxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'config-1',
        property_id: 'property-1',
        google_email: 'leasing@example.com',
      }),
      {
        historyIdHint: 'history-1',
      }
    )
  })

  it('acknowledges stale history ids without reprocessing inbox sync', async () => {
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
                      property_id: 'property-1',
                      profile_id: 'profile-1',
                      google_email: 'leasing@example.com',
                      access_token: 'access-token',
                      refresh_token: 'refresh-token',
                      token_expires_at: '2026-03-11T00:00:00.000Z',
                      sync_enabled: true,
                      auto_reply_enabled: false,
                      signature_template: null,
                      token_status: 'healthy',
                      last_sync_at: null,
                      history_id: '500',
                      watch_expiration: null,
                    },
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
    const payload = Buffer.from(
      JSON.stringify({
        emailAddress: 'leasing@example.com',
        historyId: '499',
      }),
      'utf-8'
    ).toString('base64')
    const request = new Request('http://localhost/api/lumaleasing/email/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          data: payload,
          messageId: 'pubsub-1',
          publishTime: '2026-03-10T00:00:00.000Z',
        },
        subscription: 'sub-1',
      }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(syncInboxMock).not.toHaveBeenCalled()
  })

  it('acknowledges incomplete email configurations without calling sync', async () => {
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
                      property_id: null,
                      profile_id: 'profile-1',
                      google_email: 'leasing@example.com',
                      access_token: 'access-token',
                      refresh_token: 'refresh-token',
                      token_expires_at: '2026-03-11T00:00:00.000Z',
                      sync_enabled: true,
                      auto_reply_enabled: false,
                      signature_template: null,
                      token_status: 'healthy',
                      last_sync_at: null,
                      history_id: null,
                      watch_expiration: null,
                    },
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
    const payload = Buffer.from(
      JSON.stringify({
        emailAddress: 'leasing@example.com',
        historyId: 'history-1',
      }),
      'utf-8'
    ).toString('base64')
    const request = new Request('http://localhost/api/lumaleasing/email/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          data: payload,
          messageId: 'pubsub-1',
          publishTime: '2026-03-10T00:00:00.000Z',
        },
        subscription: 'sub-1',
      }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(syncInboxMock).not.toHaveBeenCalled()
  })
})
