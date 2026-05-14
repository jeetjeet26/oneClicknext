import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

describe('integration invite revoke route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
  })

  it('revokes an invite after property access validation', async () => {
    const updateEqMock = vi.fn().mockResolvedValue({ error: null })
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'integration_auth_invites') throw new Error(`Unexpected table ${table}`)
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'invite-1', property_id: 'property-1' },
                error: null,
              }),
            })),
          })),
          update: vi.fn(() => ({
            eq: updateEqMock,
          })),
        }
      }),
    })

    const { DELETE } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/integration-invites/invite-1',
      { method: 'DELETE' }
    ) as NextRequest

    const response = await DELETE(request, { params: Promise.resolve({ id: 'invite-1' }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
  })
})
