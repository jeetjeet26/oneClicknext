import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createAdminClientMock = vi.fn()
const fromMock = vi.fn()
const rpcMock = vi.fn()
const afterMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: afterMock,
  }
})

describe('properties add route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReset()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    createAdminClientMock.mockReturnValue({
      from: fromMock,
      rpc: rpcMock,
    })
  })

  it('POST returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/properties/add', {
        method: 'POST',
        body: JSON.stringify({ name: 'New Property' }),
      }) as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('POST returns 403 when role lacks permission', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    const singleMock = vi.fn().mockResolvedValue({
      data: { org_id: 'org-1', role: 'member' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/properties/add', {
        method: 'POST',
        body: JSON.stringify({ name: 'New Property' }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Only admins and managers can add properties' })
  })

  it('POST returns 400 for an unknown property type', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/properties/add', {
        method: 'POST',
        body: JSON.stringify({ name: 'New Property', propertyType: 'hotel' }),
      }) as NextRequest
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid property type' })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('POST responds immediately and defers the website scrape to after()', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    const profileSingleMock = vi.fn().mockResolvedValue({
      data: { org_id: 'org-1', role: 'admin' },
      error: null,
    })
    const insertSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'prop-1', name: 'New Property' },
      error: null,
    })
    fromMock.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ single: profileSingleMock }),
          }),
        }
      }
      if (table === 'properties') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({ single: insertSingleMock }),
          }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })
    rpcMock.mockResolvedValue({ data: null, error: null })

    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/properties/add', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Property',
          websiteUrl: 'https://example.com',
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      property: { id: 'prop-1' },
    })

    // Scrape must be deferred, never awaited in the request path
    expect(afterMock).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })
})
