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

vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: vi.fn(),
      },
    }
  },
}))

describe('POST /api/reviewflow/sync', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv, CRON_SECRET: 'expected-secret' }
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  function buildRequest(headers?: Record<string, string>) {
    return new Request('http://localhost/api/reviewflow/sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({
        propertyId: 'property-1',
        platform: 'google',
      }),
    }) as NextRequest
  }

  it('returns 401 for a non-cron unauthenticated caller', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { POST } = await import('./route')
    const response = await POST(buildRequest())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('returns 403 for an authenticated caller without property access', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
      error: 'Forbidden',
    })

    const { POST } = await import('./route')
    const response = await POST(buildRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('allows a cron-authenticated caller to bypass user auth', async () => {
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'review_platform_connections') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({
                      data: null,
                      error: { message: 'not found' },
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

    const { POST } = await import('./route')
    const response = await POST(
      buildRequest({ authorization: 'Bearer expected-secret' })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'No active connection found for this platform',
    })
    expect(createClientMock).not.toHaveBeenCalled()
  })
})
