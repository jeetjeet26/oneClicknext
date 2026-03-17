import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

describe('LeadPulse insights route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      error: new Error('unauthorized'),
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/leadpulse/insights') as NextRequest & {
      nextUrl: NextRequest['nextUrl']
    }
    request.nextUrl = new URL(request.url) as unknown as NextRequest['nextUrl']

    const response = await GET(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns empty insights when there are no leads', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { org_id: 'org-1' },
                }),
              })),
            })),
          }
        }

        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({
                  data: [],
                  count: 0,
                }),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/leadpulse/insights') as NextRequest & {
      nextUrl: NextRequest['nextUrl']
    }
    request.nextUrl = new URL(request.url) as unknown as NextRequest['nextUrl']

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toEqual({
      insights: {
        totalLeads: 0,
        scoredLeads: 0,
        avgScore: 0,
        distribution: [],
        topFactors: { positive: [], negative: [] },
        recentTrend: [],
      }
    })
  })
})
