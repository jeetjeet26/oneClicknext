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
const attachmentId = '22222222-2222-4222-8222-222222222222'

describe('SiteForge editor attachment delete route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SITEFORGE_SEMANTIC_EDITOR_ENABLED', 'true')
    createClient.mockResolvedValue({ auth: { getUser } })
  })

  it('requires authentication before loading private metadata', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    const { DELETE } = await import('./route')
    const response = await DELETE(
      new Request(
        `http://localhost/api/siteforge/editor/sessions/${sessionId}/attachments/${attachmentId}`,
        { method: 'DELETE' }
      ) as NextRequest,
      { params: Promise.resolve({ sessionId, attachmentId }) }
    )
    expect(response.status).toBe(401)
    expect(createServiceClient).not.toHaveBeenCalled()
  })
})
