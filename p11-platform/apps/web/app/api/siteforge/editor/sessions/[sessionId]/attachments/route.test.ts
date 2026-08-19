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
  const body = new FormData()
  body.set('file', new File(['image'], 'reference.png', { type: 'image/png' }))
  body.set(
    'expectedArtifactId',
    '22222222-2222-4222-8222-222222222222'
  )
  body.set('expectedContentHash', 'a'.repeat(64))
  body.set('pageSlug', 'home')
  body.set('viewport', 'desktop')
  return new Request(
    `http://localhost/api/siteforge/editor/sessions/${sessionId}/attachments`,
    { method: 'POST', body }
  ) as NextRequest
}

describe('SiteForge editor attachment upload route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SITEFORGE_SEMANTIC_EDITOR_ENABLED', 'true')
    createClient.mockResolvedValue({ auth: { getUser } })
  })

  it('validates the session identity before authentication', async () => {
    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({ sessionId: 'invalid' }),
    })
    expect(response.status).toBe(400)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('requires authentication before private storage access', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({ sessionId }),
    })
    expect(response.status).toBe(401)
    expect(createServiceClient).not.toHaveBeenCalled()
  })
})
