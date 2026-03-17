import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const fetchMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

describe('integrations google-ads sync route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('POST returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/integrations/google-ads/sync', {
        method: 'POST',
        body: JSON.stringify({
          connectionId: 'conn-1',
          accountId: '123',
          propertyId: 'property-1',
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('POST returns 403 when property access denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/integrations/google-ads/sync', {
        method: 'POST',
        body: JSON.stringify({
          connectionId: 'conn-1',
          accountId: '123',
          propertyId: 'property-1',
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('syncGoogleAdsConnection marks retryable provider failures on the connection', async () => {
    vi.stubEnv('GOOGLE_ADS_CLIENT_ID', 'client-id')
    vi.stubEnv('GOOGLE_ADS_CLIENT_SECRET', 'client-secret')
    vi.stubEnv('GOOGLE_ADS_REFRESH_TOKEN', 'refresh-token')
    vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', 'developer-token')
    vi.stubEnv('GOOGLE_ADS_CUSTOMER_ID', '9999999999')

    const updatePayloads: Array<Record<string, unknown>> = []
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'ad_account_connections') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { error_count: 1 },
                  error: null,
                }),
              })),
            })),
            update: vi.fn((payload: Record<string, unknown>) => {
              updatePayloads.push(payload)
              return {
                eq: vi.fn().mockResolvedValue({ error: null }),
              }
            }),
          }
        }

        if (table === 'fact_marketing_performance') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: vi.fn().mockResolvedValue('temporary outage'),
    })

    const { syncGoogleAdsConnection } = await import('./route')
    const result = await syncGoogleAdsConnection('conn-1', '123-456-7890', 'property-1')

    expect(result).toEqual({
      synced: 0,
      error: 'HTTP 503',
      retryable: true,
    })
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        error_count: 2,
        last_error: 'HTTP 503',
      })
    )
  })

  it('syncGoogleAdsConnection resets connection errors when a fetch succeeds with no rows', async () => {
    vi.stubEnv('GOOGLE_ADS_CLIENT_ID', 'client-id')
    vi.stubEnv('GOOGLE_ADS_CLIENT_SECRET', 'client-secret')
    vi.stubEnv('GOOGLE_ADS_REFRESH_TOKEN', 'refresh-token')
    vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', 'developer-token')
    vi.stubEnv('GOOGLE_ADS_CUSTOMER_ID', '9999999999')

    const updatePayloads: Array<Record<string, unknown>> = []
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'ad_account_connections') {
          return {
            update: vi.fn((payload: Record<string, unknown>) => {
              updatePayloads.push(payload)
              return {
                eq: vi.fn().mockResolvedValue({ error: null }),
              }
            }),
          }
        }

        if (table === 'fact_marketing_performance') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ access_token: 'access-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      })

    const { syncGoogleAdsConnection } = await import('./route')
    const result = await syncGoogleAdsConnection('conn-1', '123-456-7890', 'property-1')

    expect(result).toEqual({ synced: 0 })
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        error_count: 0,
        last_error: null,
        last_synced_at: expect.any(String),
      })
    )
  })
})
