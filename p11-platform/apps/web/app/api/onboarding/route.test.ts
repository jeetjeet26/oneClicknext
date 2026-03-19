import { beforeEach, describe, expect, it, vi } from 'vitest'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createAdminClientMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

describe('onboarding route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      new Request('http://localhost/api/onboarding', {
        method: 'POST',
        body: JSON.stringify({}),
      })
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
    const response = await GET()

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns explicit partial failure when downstream setup work fails', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    const profileSelectSingleMock = vi.fn().mockResolvedValue({
      data: { org_id: null },
      error: null,
    })
    const profileSelectEqMock = vi.fn().mockReturnValue({ single: profileSelectSingleMock })
    const profileSelectMock = vi.fn().mockReturnValue({ eq: profileSelectEqMock })
    const profileUpdateEqMock = vi.fn().mockResolvedValue({ error: null })
    const profileUpdateMock = vi.fn().mockReturnValue({ eq: profileUpdateEqMock })
    const profileTable = {
      select: profileSelectMock,
      update: profileUpdateMock,
    }

    const orgInsertSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'org-1', name: 'P11 Smoke Org' },
      error: null,
    })
    const orgInsertMock = vi.fn().mockReturnValue({
      select: vi.fn(() => ({ single: orgInsertSingleMock })),
    })

    const propertyInsertSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'property-1', name: 'P11 Smoke Property' },
      error: null,
    })
    const propertyInsertMock = vi.fn().mockReturnValue({
      select: vi.fn(() => ({ single: propertyInsertSingleMock })),
    })

    const contactsInsertMock = vi.fn().mockResolvedValue({ error: { message: 'contact failure' } })
    const knowledgeInsertMock = vi.fn().mockResolvedValue({ error: null })
    const rpcMock = vi.fn().mockResolvedValue({ error: null })

    createAdminClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'profiles') return profileTable
        if (table === 'organizations') return { insert: orgInsertMock }
        if (table === 'properties') return { insert: propertyInsertMock }
        if (table === 'property_contacts') return { insert: contactsInsertMock }
        if (table === 'knowledge_sources') return { insert: knowledgeInsertMock }
        if (table === 'integration_credentials') return { insert: vi.fn().mockResolvedValue({ error: null }) }
        throw new Error(`Unexpected table ${table}`)
      },
      rpc: rpcMock,
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          organization: { name: 'P11 Smoke Org' },
          property: { name: 'P11 Smoke Property', type: 'multifamily' },
          contacts: [{ type: 'primary', name: 'Admin User', email: 'admin@example.com' }],
        }),
      })
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Onboarding created the organization and property, but one or more downstream setup steps failed',
      organization: { id: 'org-1' },
      property: { id: 'property-1' },
      setupFailures: ['property_contacts_failed'],
    })
  })
})
