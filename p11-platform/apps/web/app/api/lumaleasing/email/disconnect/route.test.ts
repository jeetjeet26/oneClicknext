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

describe('email disconnect route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/lumaleasing/email/disconnect', {
        method: 'POST',
        body: JSON.stringify({ propertyId: 'property-1' }),
      }) as NextRequest
    )

    expect(response.status).toBe(401)
  })

  it('clears stored email tokens and disables email config for an authorized property', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    const emailUpdateMock = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn().mockResolvedValue({ data: [{ id: 'email-1' }], error: null }),
        })),
      })),
    }))
    const configUpdateMock = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    }))
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_configurations') {
          return { update: emailUpdateMock }
        }
        if (table === 'lumaleasing_config') {
          return { update: configUpdateMock }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/lumaleasing/email/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: 'property-1', provider: 'google' }),
      }) as NextRequest
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true, disconnected: 1 })
    expect(emailUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: null,
        refresh_token: null,
        sync_enabled: false,
        token_status: 'disconnected',
      })
    )
    expect(configUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email_enabled: false,
        email_configuration_id: null,
      })
    )
  })
})
