import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createAdminClientMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

describe('properties create route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReset()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    createAdminClientMock.mockReturnValue({
      from: fromMock,
    })
  })

  it('POST returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/properties/create', {
        method: 'POST',
        body: JSON.stringify({ property: { name: 'New Property' }, contacts: [] }),
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
      new Request('http://localhost/api/properties/create', {
        method: 'POST',
        body: JSON.stringify({
          property: { name: 'New Property' },
          contacts: [{ type: 'primary', name: 'A', email: 'a@example.com' }],
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Only admins and managers can add properties' })
  })

  it('POST reuses existing property identity when existingPropertyId is provided', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    fromMock.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { org_id: 'org-1', role: 'admin' },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'properties') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'property-1' },
                  error: null,
                }),
              })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'property-1', name: 'Updated Property' },
                  error: null,
                }),
              })),
            })),
          })),
        }
      }

      if (table === 'property_contacts') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }

      if (table === 'integration_credentials') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }

      if (table === 'knowledge_sources') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              })),
            })),
          })),
          insert: vi.fn().mockResolvedValue({ error: null }),
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        }
      }

      throw new Error(`Unexpected table ${table}`)
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/properties/create', {
        method: 'POST',
        body: JSON.stringify({
          existingPropertyId: 'property-1',
          property: { name: 'Updated Property' },
          contacts: [{ type: 'primary', name: 'Primary', email: 'primary@example.com' }],
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      reusedExistingProperty: true,
      property: { id: 'property-1' },
    })
  })
})
