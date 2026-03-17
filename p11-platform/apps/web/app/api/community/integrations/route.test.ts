import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createAdminClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  const request = new Request(url, init) as NextRequest
  Object.defineProperty(request, 'nextUrl', {
    value: new URL(url),
    configurable: true,
  })
  return request
}

describe('community integrations route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/community/integrations?propertyId=property-1'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('GET returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/community/integrations?propertyId=property-1'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('GET computes verified readiness from credential state', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const integrationsOrderMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'int-crm',
          property_id: 'property-1',
          platform: 'crm',
          credentials: { api_key: 'secret' },
          mapping_validated: true,
          status: 'requested',
        },
        {
          id: 'int-email',
          property_id: 'property-1',
          platform: 'email_marketing',
          credentials: null,
          mapping_validated: null,
          status: 'connected',
        },
      ],
      error: null,
    })
    const integrationsEqMock = vi.fn().mockReturnValue({ order: integrationsOrderMock })
    const integrationsSelectMock = vi.fn().mockReturnValue({ eq: integrationsEqMock })

    const emailMaybeSingleMock = vi.fn().mockResolvedValue({
      data: { token_status: 'healthy', sync_enabled: true },
      error: null,
    })
    const emailEqMock = vi.fn().mockReturnValue({ maybeSingle: emailMaybeSingleMock })
    const emailSelectMock = vi.fn().mockReturnValue({ eq: emailEqMock })

    const adminFromMock = vi.fn((table: string) => {
      if (table === 'integration_credentials') {
        return { select: integrationsSelectMock }
      }
      if (table === 'email_configurations') {
        return { select: emailSelectMock }
      }
      throw new Error(`Unexpected table ${table}`)
    })
    createAdminClientMock.mockReturnValue({ from: adminFromMock })

    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/community/integrations?propertyId=property-1'))

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.integrations).toHaveLength(2)
    expect(payload.integrations[0]).toMatchObject({
      id: 'int-crm',
      platform: 'crm',
      status: 'verified',
      statusSource: 'verified_state',
      readiness: {
        mode: 'verified_state',
        ready: true,
        blockers: [],
      },
    })
    expect(payload.integrations[1]).toMatchObject({
      id: 'int-email',
      platform: 'email_marketing',
      status: 'verified',
      statusSource: 'verified_state',
      readiness: {
        mode: 'verified_state',
        ready: true,
        blockers: [],
      },
    })
    expect(adminFromMock).toHaveBeenCalledWith('integration_credentials')
    expect(adminFromMock).toHaveBeenCalledWith('email_configurations')
  })
})
