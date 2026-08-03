import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { createClient, createServiceClient, getUser } = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  getUser: vi.fn(),
}))
vi.mock('@/utils/supabase/server', () => ({ createClient }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient }))

const sessionId = '11111111-1111-4111-8111-111111111111'

function request() {
  return new Request(
    `http://localhost/api/siteforge/editor/sessions/${sessionId}/undo`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedArtifactId: '22222222-2222-4222-8222-222222222222',
        idempotencyKey: 'undo-request-1234',
      }),
    }
  ) as NextRequest
}

describe('semantic editor undo route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SITEFORGE_SEMANTIC_EDITOR_ENABLED', 'true')
    createClient.mockResolvedValue({ auth: { getUser } })
  })

  it('requires authentication before publishing rollback revisions', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({ sessionId }),
    })
    expect(response.status).toBe(401)
    expect(createServiceClient).not.toHaveBeenCalled()
  })
})
