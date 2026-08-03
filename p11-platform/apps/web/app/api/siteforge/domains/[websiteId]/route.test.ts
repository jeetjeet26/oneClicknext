import { describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }))
vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: vi.fn(),
}))

describe('SiteForge production domain route', () => {
  it('requires authentication before domain changes', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const { POST } = await import('./route')
    const response = await POST(
      new Request(
        'http://localhost/api/siteforge/domains/11111111-1111-4111-8111-111111111111',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetDomain: 'apartments.example.com',
          }),
        }
      ) as NextRequest,
      {
        params: Promise.resolve({
          websiteId: '11111111-1111-4111-8111-111111111111',
        }),
      }
    )
    expect(response.status).toBe(401)
  })
})
