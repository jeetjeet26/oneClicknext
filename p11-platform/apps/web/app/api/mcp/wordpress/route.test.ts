import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const discoverMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/siteforge/wordpress-discovery', () => ({
  discoverWordPressCapabilities: discoverMock,
}))

describe('mcp wordpress route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('POST returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/mcp/wordpress', {
        method: 'POST',
        body: JSON.stringify({ tool: 'get_wordpress_abilities', arguments: {} }),
      }) as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET()

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('POST rejects unsupported tools', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/mcp/wordpress', {
        method: 'POST',
        body: JSON.stringify({ tool: 'deploy_siteforge_blueprint', arguments: {} }),
      }) as NextRequest
    )

    expect(response.status).toBe(400)
    expect(discoverMock).not.toHaveBeenCalled()
  })

  it('POST returns discovered capabilities for the supported tool', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    discoverMock.mockResolvedValue({ availableBlocks: ['acf/top-slides'] })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/mcp/wordpress', {
        method: 'POST',
        body: JSON.stringify({ tool: 'get_wordpress_capabilities', arguments: {} }),
      }) as NextRequest
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      result: { availableBlocks: ['acf/top-slides'] },
    })
  })
})
