import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { createClient, createServiceClient, getUser } = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  getUser: vi.fn(),
}))
vi.mock('@/utils/supabase/server', () => ({ createClient }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient }))

function request() {
  return new Request('http://localhost/api/siteforge/editor/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      websiteId: '11111111-1111-4111-8111-111111111111',
    }),
  }) as NextRequest
}

describe('semantic editor session route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SITEFORGE_SEMANTIC_EDITOR_ENABLED', 'true')
    createClient.mockResolvedValue({ auth: { getUser } })
  })

  it('is unavailable when the feature flag is disabled', async () => {
    vi.stubEnv('SITEFORGE_SEMANTIC_EDITOR_ENABLED', 'false')
    const { POST } = await import('./route')
    expect((await POST(request())).status).toBe(404)
  })

  it('requires authentication before loading a website', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    const { POST } = await import('./route')
    expect((await POST(request())).status).toBe(401)
    expect(createServiceClient).not.toHaveBeenCalled()
  })
})
