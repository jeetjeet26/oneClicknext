import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const createIntegrationAuthInviteMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/integration-auth-invites', () => ({
  createIntegrationAuthInvite: createIntegrationAuthInviteMock,
  buildExternalIntegrationLink: vi.fn((token: string) => `https://app.example.com/lumaleasing/integrations/connect?token=${token}`),
}))

describe('integration invites route', () => {
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
    createIntegrationAuthInviteMock.mockResolvedValue({
      invite: { id: 'invite-1' },
      token: 'token-1',
      url: 'https://app.example.com/lumaleasing/integrations/connect?token=token-1',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a property-scoped invite link', async () => {
    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/integration-invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        propertyId: 'property-1',
        provider: 'microsoft',
        capabilities: ['calendar'],
      }),
    }) as NextRequest

    const response = await POST(request)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(createIntegrationAuthInviteMock).toHaveBeenCalledWith({
      propertyId: 'property-1',
      provider: 'microsoft',
      capabilities: ['calendar'],
      createdByProfileId: 'user-1',
      expiresAt: undefined,
    })
    expect(payload.url).toContain('/lumaleasing/integrations/connect?token=token-1')
  })

  it('rejects unsupported providers', async () => {
    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/integration-invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        propertyId: 'property-1',
        provider: 'smtp',
        capabilities: ['email'],
      }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Provider must be google or microsoft' })
  })
})
