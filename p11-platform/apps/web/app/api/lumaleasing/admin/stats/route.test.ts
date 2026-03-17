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

describe('Luma admin stats route', () => {
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
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/admin/stats?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns aggregated stats for an authorized property', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })

    let widgetSessionsSelectCalls = 0
    let conversationsSelectCalls = 0

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'widget_sessions') {
          widgetSessionsSelectCalls += 1
          const selectCall = widgetSessionsSelectCalls
          return {
            select: vi.fn(() => {
              if (selectCall === 1) {
                return {
                  eq: vi.fn().mockResolvedValue({ count: 3 }),
                }
              }

              return {
                eq: vi.fn(() => ({
                  not: vi.fn().mockResolvedValue({ count: 3 }),
                })),
              }
            }),
          }
        }

        if (table === 'conversations') {
          conversationsSelectCalls += 1
          const selectCall = conversationsSelectCalls
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => {
                  if (selectCall === 1) {
                    return Promise.resolve({ count: 4 })
                  }

                  return {
                    order: vi.fn(() => ({
                      limit: vi.fn().mockResolvedValue({
                        data: [{ id: 'conv-1' }],
                      }),
                    })),
                  }
                }),
              })),
            })),
          }
        }

        if (table === 'tour_bookings') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({
                  count: 2,
                }),
              })),
            })),
          }
        }

        if (table === 'messages') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(() => ({
                order: vi.fn().mockResolvedValue({
                  data: [
                    {
                      conversation_id: 'conv-1',
                      role: 'user',
                      created_at: '2026-03-12T10:00:00.000Z',
                    },
                    {
                      conversation_id: 'conv-1',
                      role: 'assistant',
                      created_at: '2026-03-12T10:00:10.000Z',
                    },
                  ],
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
      'http://localhost/api/lumaleasing/admin/stats?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toMatchObject({
      totalSessions: 3,
      totalConversations: 4,
      leadsCapture: 3,
      toursBooked: 2,
      avgResponseTime: 10000,
      conversionRate: 100,
    })
  })
})
