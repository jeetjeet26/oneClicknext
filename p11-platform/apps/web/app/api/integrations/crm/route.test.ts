import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createAdminClientMock = vi.fn()
const syncLeadToCRMMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({createAdminClient:createAdminClientMock}))

vi.mock('@/utils/services/crm-sync', () => ({
  syncLeadToCRM: syncLeadToCRMMock,
}))

describe('integrations crm route auth', () => {
  afterEach(() => vi.unstubAllEnvs())
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('OUTBOUND_DELIVERY_PAUSED', 'false')
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('POST returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/integrations/crm', {
        method: 'POST',
        body: JSON.stringify({ action: 'test-connection' }),
      }) as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/integrations/crm?action=tourspark-schema') as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('GET integration-status includes Lasso in supported CRM platforms', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    const platformInMock = vi.fn(() => ({
      single: vi.fn().mockResolvedValue({
        data: {
          platform: 'lasso',
          status: 'connected',
          credentials: {api_key:'private-fixture-key'},
        },
        error: null,
      }),
    }))
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
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
                single: vi.fn().mockResolvedValue({
                  data: { org_id: 'org-1' },
                  error: null,
                }),
              })),
            })),
          }
        }
        if (table === 'integration_credentials') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: platformInMock,
              })),
            })),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    createAdminClientMock.mockReturnValue({from:()=>({select:()=>({eq:()=>({in:platformInMock})})})})

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/integrations/crm?action=integration-status&propertyId=property-1') as NextRequest
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      configured: true,
      integration: {
        platform: 'lasso',
      },
    })
    expect(JSON.stringify(await (await GET(new Request('http://localhost/api/integrations/crm?action=integration-status&propertyId=property-1') as NextRequest)).json())).not.toContain('private-fixture-key')
    expect(platformInMock).toHaveBeenCalledWith(
      'platform',
      expect.arrayContaining(['lasso'])
    )
  })

  it('POST old connection check requires saved setup workflow', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          message: 'Connection test failed',
          error: 'Authentication failed - check Lasso API key and project access',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
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
                single: vi.fn().mockResolvedValue({
                  data: { org_id: 'org-1' },
                  error: null,
                }),
              })),
            })),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/integrations/crm', {
        method: 'POST',
        body: JSON.stringify({
          action: 'test-connection',
          propertyId: 'property-1',
          crmType: 'lasso',
          credentials: { api_key: 'bad-key' },
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POST dead-letter-list returns dead-lettered leads for authorized user', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
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
                single: vi.fn().mockResolvedValue({
                  data: { org_id: 'org-1' },
                  error: null,
                }),
              })),
            })),
          }
        }
        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn().mockResolvedValue({
                      data: [
                        {
                          id: 'lead-1',
                          first_name: 'Jane',
                          last_name: 'Doe',
                          email: 'jane@example.com',
                          crm_sync_status: 'dead_lettered',
                          crm_sync_error: 'invalid mapping',
                          crm_sync_retry_count: 4,
                        },
                      ],
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/integrations/crm', {
        method: 'POST',
        body: JSON.stringify({
          action: 'dead-letter-list',
          propertyId: 'property-1',
          limit: 10,
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      leads: expect.arrayContaining([
        expect.objectContaining({
          id: 'lead-1',
          crm_sync_status: 'dead_lettered',
        }),
      ]),
    })
  })

  it('POST legacy replay cannot bypass saved transfer review', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    syncLeadToCRMMock.mockResolvedValue({
      success: true,
      action: 'linked',
      externalId: 'crm-123',
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
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
                single: vi.fn().mockResolvedValue({
                  data: { org_id: 'org-1' },
                  error: null,
                }),
              })),
            })),
          }
        }
        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'lead-1',
                      property_id: 'property-1',
                      first_name: 'Jane',
                      last_name: 'Doe',
                      email: 'jane@example.com',
                      phone: null,
                      source: 'manual',
                      status: 'new',
                      move_in_date: null,
                      bedrooms: 2,
                      notes: null,
                      crm_sync_retry_count: 2,
                    },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/integrations/crm', {
        method: 'POST',
        body: JSON.stringify({
          action: 'replay-dead-letter-now',
          propertyId: 'property-1',
          leadId: 'lead-1',
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(409)
    expect(syncLeadToCRMMock).not.toHaveBeenCalled()

  })
})

// Even the raw CRM proxy must respect the global delivery hold.
describe('CRM delivery hold', () => {
 it('blocks writes, test-record creation and replay before the data engine is called', async () => {
  vi.clearAllMocks()
  vi.stubEnv('OUTBOUND_DELIVERY_PAUSED', 'true')
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
  authGetUserMock.mockResolvedValue({data:{user:{id:'actor'}},error:null})
  createClientMock.mockResolvedValue({auth:{getUser:authGetUserMock}})
  try {
   const { POST } = await import('./route')
   for (const action of ['push-lead','bulk-sync','validate-mapping','replay-dead-letter-now']) {
    const result = await POST(new Request('http://localhost/api/integrations/crm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})}) as NextRequest)
    expect(result.status).toBe(423)
   }
   expect(fetchMock).not.toHaveBeenCalled(); expect(syncLeadToCRMMock).not.toHaveBeenCalled()
  } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals() }
 })
})
