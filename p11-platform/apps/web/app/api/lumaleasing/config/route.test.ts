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

describe('Luma public config route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRateLimitKeyMock.mockReturnValue('config-key')
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

  it('returns 401 when the api key is missing', async () => {
    const { GET } = await import('./route')

    const request = new Request('http://localhost/api/lumaleasing/config', {
      method: 'GET',
    }) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'API key required' })
  })

  it('returns 429 when the public config route is rate limited', async () => {
    publicReadLimiterCheckMock.mockReturnValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      retryAfterMs: 60_000,
    })
    rateLimitHeadersMock.mockReturnValue({ 'Retry-After': '60' })

    const { GET } = await import('./route')

    const request = new Request(
      'http://localhost/api/lumaleasing/config?apiKey=test-key',
      { method: 'GET' }
    ) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(429)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(response.headers.get('Retry-After')).toBe('60')
    await expect(response.json()).resolves.toEqual({
      error: 'Too many requests. Please try again later.',
    })
  })

  it('returns widget config for a valid api key', async () => {
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    widget_name: 'Luma',
                    primary_color: '#6366f1',
                    secondary_color: '#8b5cf6',
                    logo_url: 'https://example.com/logo.png',
                    welcome_message: 'Hi there!',
                    offline_message: 'Offline',
                    auto_popup_delay_seconds: 10,
                    require_email_before_chat: false,
                    collect_name: true,
                    collect_email: true,
                    collect_phone: false,
                    lead_capture_prompt: 'Share your info',
                    tours_enabled: true,
                    business_hours: {
                      monday: { start: '00:00', end: '23:59' },
                      tuesday: { start: '00:00', end: '23:59' },
                      wednesday: { start: '00:00', end: '23:59' },
                      thursday: { start: '00:00', end: '23:59' },
                      friday: { start: '00:00', end: '23:59' },
                      saturday: { start: '00:00', end: '23:59' },
                      sunday: { start: '00:00', end: '23:59' },
                    },
                    timezone: 'UTC',
                    is_active: true,
                    properties: { id: 'property-1', name: 'The Beacon' },
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

    const { GET } = await import('./route')

    const request = new Request(
      'http://localhost/api/lumaleasing/config?apiKey=test-key',
      { method: 'GET' }
    ) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toMatchObject({
      config: {
        widgetName: 'Luma',
        propertyName: 'The Beacon',
        toursEnabled: true,
      },
      isOnline: true,
      timezone: 'UTC',
    })
  })
})
