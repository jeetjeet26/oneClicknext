import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { getUserMock, createServiceClientMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  createServiceClientMock: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

function request(body: unknown): NextRequest {
  return new Request(
    'http://localhost/api/siteforge/extensions/request/decision',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  ) as NextRequest
}

describe('SiteForge runtime extension decisions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
  })

  it('validates the request identity and decision before side effects', async () => {
    const { POST } = await import('./route')
    const response = await POST(request({ decision: 'execute', reason: '' }), {
      params: Promise.resolve({ requestId: 'invalid' }),
    })
    expect(response.status).toBe(400)
  })

  it('requires authentication for extension approval', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      request({ decision: 'approved', reason: 'Approved for sandbox review' }),
      {
        params: Promise.resolve({
          requestId: '11111111-1111-4111-8111-111111111111',
        }),
      }
    )
    expect(response.status).toBe(401)
  })

  it('allows an organization manager to approve a proposed extension', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'manager-1' } },
      error: null,
    })
    const updated: Record<string, unknown>[] = []
    createServiceClientMock.mockReturnValue({
      from: (table: string) => {
        const query = {
          select: () => query,
          eq: () => query,
          single: async () => ({
            data:
              table === 'profiles'
                ? { org_id: 'org-1', role: 'manager' }
                : { id: '11111111-1111-4111-8111-111111111111', org_id: 'org-1', status: 'proposed' },
            error: null,
          }),
          update: (value: Record<string, unknown>) => {
            updated.push(value)
            return query
          },
          maybeSingle: async () => ({
            data: {
              id: '11111111-1111-4111-8111-111111111111',
              status: 'approved',
            },
            error: null,
          }),
        }
        return query
      },
    })

    const { POST } = await import('./route')
    const response = await POST(
      request({
        decision: 'approved',
        reason: 'Approved for signed sandbox validation',
      }),
      {
        params: Promise.resolve({
          requestId: '11111111-1111-4111-8111-111111111111',
        }),
      }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      requestId: '11111111-1111-4111-8111-111111111111',
      status: 'approved',
    })
    expect(updated).toEqual([
      expect.objectContaining({
        status: 'approved',
        decision_by: 'manager-1',
      }),
    ])
  })
})
