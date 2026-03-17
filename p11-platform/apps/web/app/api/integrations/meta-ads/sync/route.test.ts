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

describe('integrations meta-ads sync route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('POST returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/integrations/meta-ads/sync', {
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
      new Request('http://localhost/api/integrations/meta-ads/sync', {
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

  it('syncMetaAdsConnection marks missing credentials as a permanent connection failure', async () => {
    delete process.env.META_ACCESS_TOKEN

    const updatePayloads: Array<Record<string, unknown>> = []
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'ad_account_connections') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { error_count: 0 },
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

    const { syncMetaAdsConnection } = await import('./route')
    const result = await syncMetaAdsConnection('conn-1', '123', 'property-1')

    expect(result).toEqual({
      synced: 0,
      error: 'META_ACCESS_TOKEN not configured',
      retryable: false,
    })
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        error_count: 1,
        last_error: 'META_ACCESS_TOKEN not configured',
      })
    )
  })
})
