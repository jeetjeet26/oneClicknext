import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const websiteId = '11111111-1111-4111-8111-111111111111'

function request(method: 'GET' | 'POST'): NextRequest {
  return new Request(`http://localhost/api/siteforge/rollback/${websiteId}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body:
      method === 'POST'
        ? JSON.stringify({
            expectedCurrentArtifactId:
              '22222222-2222-4222-8222-222222222222',
            targetArtifactId: '33333333-3333-4333-8333-333333333333',
            targetContentHash: 'a'.repeat(64),
            decisionReason: 'Restore the last remotely certified release.',
          })
        : undefined,
  }) as NextRequest
}

describe('verified immutable rollback route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
  })

  it('requires authentication when listing certified rollback targets', async () => {
    const { GET } = await import('./route')
    const response = await GET(request('GET'), {
      params: Promise.resolve({ websiteId }),
    })
    expect(response.status).toBe(401)
  })

  it('requires authentication before creating rollback artifacts', async () => {
    const { POST } = await import('./route')
    const response = await POST(request('POST'), {
      params: Promise.resolve({ websiteId }),
    })
    expect(response.status).toBe(401)
  })

  it('rejects invalid website identifiers before any side effect', async () => {
    const { POST } = await import('./route')
    const response = await POST(request('POST'), {
      params: Promise.resolve({ websiteId: 'invalid' }),
    })
    expect(response.status).toBe(400)
  })
})
