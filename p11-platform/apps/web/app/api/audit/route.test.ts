import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

describe('audit route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReset()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost/api/audit') as NextRequest)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('GET returns 403 for non-admin users', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    const singleMock = vi.fn().mockResolvedValue({
      data: { org_id: 'org-1', role: 'manager' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost/api/audit') as NextRequest)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden - Admin access required' })
  })
})
