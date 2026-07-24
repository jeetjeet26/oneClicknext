import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createServiceClientMock = vi.fn()
const getRateLimitKeyMock = vi.fn()
const rateLimitHeadersMock = vi.fn()
const publicReadLimiterCheckMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/rate-limiter', () => ({
  publicReadLimiter: {
    check: publicReadLimiterCheckMock,
  },
  getRateLimitKey: getRateLimitKeyMock,
  rateLimitHeaders: rateLimitHeadersMock,
}))

const SESSION_ID = '11111111-2222-4333-8444-555555555555'
const CONVERSATION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const PROPERTY_ID = 'property-1'

type SupabaseFixture = {
  config?: { property_id: string | null; is_active: boolean | null } | null
  session?: {
    id: string
    lead_id: string | null
    started_at: string | null
    last_activity_at: string | null
  } | null
  conversation?: { id: string; is_human_mode: boolean | null } | null
  messages?: Array<{
    id: string
    role: string | null
    content: string | null
    created_at: string | null
  }>
  messagesError?: { message: string } | null
}

function buildSupabaseMock(fixture: SupabaseFixture) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'lumaleasing_config') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: fixture.config ?? null,
                error: fixture.config ? null : { message: 'not found' },
              }),
            })),
          })),
        }
      }

      if (table === 'widget_sessions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: fixture.session ?? null,
                  error: fixture.session ? null : { message: 'not found' },
                }),
              })),
            })),
          })),
        }
      }

      if (table === 'conversations') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: fixture.conversation ?? null,
                    error: fixture.conversation ? null : { message: 'not found' },
                  }),
                })),
              })),
            })),
          })),
        }
      }

      if (table === 'messages') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue({
                  data: fixture.messages ?? [],
                  error: fixture.messagesError ?? null,
                }),
              })),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table ${table}`)
    }),
  }
}

function buildRequest(params?: { sessionId?: string; apiKey?: string }) {
  const url = new URL('http://localhost/api/lumaleasing/session/history')
  if (params?.sessionId) url.searchParams.set('sessionId', params.sessionId)

  return new Request(url.toString(), {
    method: 'GET',
    headers: params?.apiKey ? { 'X-API-Key': params.apiKey } : undefined,
  }) as NextRequest
}

describe('Luma session history route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRateLimitKeyMock.mockReturnValue('history-key')
    publicReadLimiterCheckMock.mockReturnValue({
      allowed: true,
      remaining: 59,
      resetAt: Date.now() + 60_000,
    })
    rateLimitHeadersMock.mockReturnValue({})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 429 when rate limited', async () => {
    publicReadLimiterCheckMock.mockReturnValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      retryAfterMs: 60_000,
    })
    rateLimitHeadersMock.mockReturnValue({ 'Retry-After': '60' })

    const { GET } = await import('./route')
    const response = await GET(buildRequest({ sessionId: SESSION_ID, apiKey: 'test-key' }))

    expect(response.status).toBe(429)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(response.headers.get('Retry-After')).toBe('60')
  })

  it('returns 401 when the api key is missing', async () => {
    const { GET } = await import('./route')
    const response = await GET(buildRequest({ sessionId: SESSION_ID }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'API key required' })
  })

  it('returns 400 when sessionId is missing or malformed', async () => {
    const { GET } = await import('./route')

    const missing = await GET(buildRequest({ apiKey: 'test-key' }))
    expect(missing.status).toBe(400)

    const malformed = await GET(
      buildRequest({ sessionId: 'not-a-uuid', apiKey: 'test-key' })
    )
    expect(malformed.status).toBe(400)
  })

  it('returns 401 for an unknown api key', async () => {
    createServiceClientMock.mockReturnValue(buildSupabaseMock({ config: null }))

    const { GET } = await import('./route')
    const response = await GET(buildRequest({ sessionId: SESSION_ID, apiKey: 'bad-key' }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid API key' })
  })

  it('returns 403 when the widget is inactive', async () => {
    createServiceClientMock.mockReturnValue(
      buildSupabaseMock({ config: { property_id: PROPERTY_ID, is_active: false } })
    )

    const { GET } = await import('./route')
    const response = await GET(buildRequest({ sessionId: SESSION_ID, apiKey: 'test-key' }))

    expect(response.status).toBe(403)
  })

  it('returns 404 when the session does not belong to the property', async () => {
    createServiceClientMock.mockReturnValue(
      buildSupabaseMock({
        config: { property_id: PROPERTY_ID, is_active: true },
        session: null,
      })
    )

    const { GET } = await import('./route')
    const response = await GET(buildRequest({ sessionId: SESSION_ID, apiKey: 'test-key' }))

    expect(response.status).toBe(404)
  })

  it('returns 410 when the session is idle past the expiry window', async () => {
    const staleTimestamp = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
    createServiceClientMock.mockReturnValue(
      buildSupabaseMock({
        config: { property_id: PROPERTY_ID, is_active: true },
        session: {
          id: SESSION_ID,
          lead_id: null,
          started_at: staleTimestamp,
          last_activity_at: staleTimestamp,
        },
      })
    )

    const { GET } = await import('./route')
    const response = await GET(buildRequest({ sessionId: SESSION_ID, apiKey: 'test-key' }))

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({ error: 'Session expired' })
  })

  it('returns an empty transcript when the session has no conversation yet', async () => {
    createServiceClientMock.mockReturnValue(
      buildSupabaseMock({
        config: { property_id: PROPERTY_ID, is_active: true },
        session: {
          id: SESSION_ID,
          lead_id: 'lead-1',
          started_at: new Date().toISOString(),
          last_activity_at: new Date().toISOString(),
        },
        conversation: null,
      })
    )

    const { GET } = await import('./route')
    const response = await GET(buildRequest({ sessionId: SESSION_ID, apiKey: 'test-key' }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({
      sessionId: SESSION_ID,
      conversationId: null,
      isHumanMode: false,
      leadCaptured: true,
      messages: [],
    })
  })

  it('returns the transcript with conversation state for a valid session', async () => {
    createServiceClientMock.mockReturnValue(
      buildSupabaseMock({
        config: { property_id: PROPERTY_ID, is_active: true },
        session: {
          id: SESSION_ID,
          lead_id: null,
          started_at: new Date().toISOString(),
          last_activity_at: new Date().toISOString(),
        },
        conversation: { id: CONVERSATION_ID, is_human_mode: true },
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'Do you allow pets?',
            created_at: '2026-07-23T17:00:00.000Z',
          },
          {
            id: 'm2',
            role: 'assistant',
            content: 'Yes, we are pet friendly!',
            created_at: '2026-07-23T17:00:05.000Z',
          },
          {
            id: 'm3',
            role: 'assistant',
            content: '',
            created_at: '2026-07-23T17:00:06.000Z',
          },
        ],
      })
    )

    const { GET } = await import('./route')
    const response = await GET(buildRequest({ sessionId: SESSION_ID, apiKey: 'test-key' }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toEqual({
      sessionId: SESSION_ID,
      conversationId: CONVERSATION_ID,
      isHumanMode: true,
      leadCaptured: false,
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'Do you allow pets?',
          createdAt: '2026-07-23T17:00:00.000Z',
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'Yes, we are pet friendly!',
          createdAt: '2026-07-23T17:00:05.000Z',
        },
      ],
    })
  })

  it('returns 500 when the transcript query fails', async () => {
    createServiceClientMock.mockReturnValue(
      buildSupabaseMock({
        config: { property_id: PROPERTY_ID, is_active: true },
        session: {
          id: SESSION_ID,
          lead_id: null,
          started_at: new Date().toISOString(),
          last_activity_at: new Date().toISOString(),
        },
        conversation: { id: CONVERSATION_ID, is_human_mode: false },
        messagesError: { message: 'boom' },
      })
    )

    const { GET } = await import('./route')
    const response = await GET(buildRequest({ sessionId: SESSION_ID, apiKey: 'test-key' }))

    expect(response.status).toBe(500)
  })
})
