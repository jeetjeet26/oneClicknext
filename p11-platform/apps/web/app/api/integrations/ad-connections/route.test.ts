import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const readPropertyMock = vi.fn()
const managePropertyMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: readPropertyMock,
  validatePropertyManagerAccess: managePropertyMock,
}))

describe('integrations ad-connections route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/integrations/ad-connections') as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })
})

describe('property-scoped advertising connections', () => {
  const propertyId = '11111111-1111-4111-8111-111111111111'
  const actorId = '22222222-2222-4222-8222-222222222222'
  const request = () => new Request(`http://localhost/api/integrations/ad-connections?property_id=${propertyId}`) as NextRequest
  const from = vi.fn()
  const filters: [string, string][] = []
  let role: string

  beforeEach(() => {
    vi.resetAllMocks()
    filters.length = 0
    role = 'admin'
    readPropertyMock.mockResolvedValue({ authorized: true })
    managePropertyMock.mockResolvedValue({ authorized: true })
    authGetUserMock.mockResolvedValue({ data: { user: { id: actorId } }, error: null })
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from })
    from.mockImplementation(table => {
      const query = {
        select: () => query,
        eq: (column: string, value: string) => { filters.push([column, value]); return query },
        single: async () => ({ data: { org_id: 'p11', role } }),
        order: async () => ({ data: table === 'ad_account_connections' ? [{ property_id: propertyId }] : [] }),
      }
      return query
    })
  })

  it('fetches only the selected property and gives an approved operator the link controls', async () => {
    vi.stubEnv('P11_OPERATIONS_ADMIN_IDS', actorId)
    try {
      const { GET } = await import('./route')
      const response = await GET(request())
      expect(filters).toContainEqual(['org_id', 'p11'])
      expect(filters).toContainEqual(['property_id', propertyId])
      expect(readPropertyMock).toHaveBeenCalledWith(actorId, propertyId)
      expect(managePropertyMock).toHaveBeenCalledWith(actorId, propertyId)
      await expect(response.json()).resolves.toEqual({
        connections: [{ property_id: propertyId }], canManage: true, canLink: true,
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('lets authorized viewers read saved links without offering discovery or edits', async () => {
    role = 'viewer'
    const { GET } = await import('./route')
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(managePropertyMock).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ canManage: false, canLink: false })
  })

  it('denies access before reading links if the user has no grant for the selected property', async () => {
    readPropertyMock.mockResolvedValue({ authorized: false })
    const { GET } = await import('./route')
    expect((await GET(request())).status).toBe(403)
    expect(from).not.toHaveBeenCalledWith('ad_account_connections')
  })
})
