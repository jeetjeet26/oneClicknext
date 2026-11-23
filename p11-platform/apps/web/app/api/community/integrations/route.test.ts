import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createAdminClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const validatePropertyManagerAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
  validatePropertyManagerAccess: validatePropertyManagerAccessMock,
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

  it('POST denies a member who can read the property but cannot manage connections', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'reader' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    validatePropertyManagerAccessMock.mockResolvedValue({ authorized: false })

    const { POST } = await import('./route')
    const response = await POST(makeNextRequest('http://localhost/api/community/integrations', {
      method: 'POST', body: JSON.stringify({ propertyId: 'property-1', integration: { platform: 'google_ads' } }),
    }))

    expect(response.status).toBe(403)
    expect(validatePropertyManagerAccessMock).toHaveBeenCalledWith('reader', 'property-1')
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })

  it('PUT denies read-only members before altering a connection', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'reader' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    validatePropertyManagerAccessMock.mockResolvedValue({ authorized: false })
    const update = vi.fn()
    const single = vi.fn().mockResolvedValue({ data: { id: 'connection-1', property_id: 'property-1', platform: 'google_ads' }, error: null })
    const table = { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single }) }), update }
    createAdminClientMock.mockReturnValue({ from: vi.fn().mockReturnValue(table) })

    const { PUT } = await import('./route')
    const response = await PUT(makeNextRequest('http://localhost/api/community/integrations', {
      method: 'PUT', body: JSON.stringify({ integrationId: 'connection-1', status: 'connected' }),
    }))

    expect(response.status).toBe(403)
    expect(validatePropertyManagerAccessMock).toHaveBeenCalledWith('reader', 'property-1')
    expect(update).not.toHaveBeenCalled()
  })

  it.each(['POST', 'PUT'] as const)('%s preserves authorized management without returning stored tokens', async method => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'manager' } }, error: null })
    validatePropertyManagerAccessMock.mockResolvedValue({ authorized: true })
    const stored = { id: 'connection-1', property_id: 'property-1', platform: 'google_ads', credentials: { access_token: 'fake-private-token' } }
    const table = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: stored, error: null }),
    }
    createAdminClientMock.mockReturnValue({ from: vi.fn().mockReturnValue(table) })
    const route = await import('./route')
    const body = method === 'POST'
      ? { propertyId: 'property-1', integration: { platform: 'google_ads' } }
      : { integrationId: 'connection-1', notes: 'Reviewed connection' }
    const response = await route[method](makeNextRequest('http://localhost/api/community/integrations', {
      method, body: JSON.stringify(body),
    }))

    expect(response.status).toBe(200)
    expect(validatePropertyManagerAccessMock).toHaveBeenCalledWith('manager', 'property-1')
    const payload = await response.json()
    expect(payload.integration.id).toBe('connection-1')
    expect(payload.integration).not.toHaveProperty('credentials')
    expect(JSON.stringify(payload)).not.toContain('fake-private-token')
  })

  it('GET keeps legacy CRM flags unqualified and strips stored secrets', async () => {
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
    const emailEqMock = vi.fn().mockReturnValue({ is: vi.fn().mockReturnThis(), maybeSingle: emailMaybeSingleMock })
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
      status: 'requested',
      statusSource: 'verified_state',
      readiness: {
        mode: 'verified_state',
        ready: false,
        blockers: ['mapping_not_validated'],
      },
    })
    expect(JSON.stringify(payload)).not.toContain('secret')
    expect(payload.integrations[0]).not.toHaveProperty('credentials')
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
