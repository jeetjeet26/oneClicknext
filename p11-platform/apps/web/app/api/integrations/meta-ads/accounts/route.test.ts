import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => ({ from: fromMock }),
}))

describe('integrations meta-ads accounts route auth', () => {
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
    const response = await GET()

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })
})

describe('Meta Ads account discovery', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    const user = { id: 'console-operator' }
    vi.stubEnv('P11_OPERATIONS_ADMIN_IDS', user.id)
    vi.stubEnv('META_ACCESS_TOKEN', 'test-meta-token')
    authGetUserMock.mockResolvedValue({ data: { user }, error: null })
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock } })
    fromMock.mockImplementation(table => ({
      select: () => table === 'profiles'
        ? { eq: () => ({ single: async () => ({ data: { org_id: 'p11', role: 'admin' } }) }) }
        : { eq: () => ({ eq: async () => ({ data: [{
          account_id: 'act_123', property_id: 'cayman', properties: { name: 'Cayman' },
        }] }) }) },
    }))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('loads later pages using the Graph cursor and the same authenticated endpoint', async () => {
    const cayman = { id: 'act_123', name: 'Cayman' }
    fetchMock
      .mockResolvedValueOnce(Response.json({
        data: [cayman],
        paging: { next: 'https://example.invalid/unexpected', cursors: { after: 'next+page' } },
      }))
      .mockResolvedValueOnce(Response.json({ data: [cayman, { id: 'act_456', name: 'Barton' }] }))

    const { GET } = await import('./route')
    const response = await GET()
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [input, options] = fetchMock.mock.calls[1]
    const url = new URL(input)
    expect(url.origin + url.pathname).toBe('https://graph.facebook.com/v26.0/me/adaccounts')
    expect(url.searchParams.get('after')).toBe('next+page')
    expect(url.searchParams.has('access_token')).toBe(false)
    expect(options.headers.Authorization).toBe('Bearer test-meta-token')
    await expect(response.json()).resolves.toMatchObject({ accounts: [
      { id: '123', linked: true, linked_property_name: 'Cayman' },
      { id: '456', linked: false },
    ] })
  })

  it('returns an error when Meta supplies a next link without an advancing cursor', async () => {
    const page = { data: [{ id: 'act_123' }], paging: { next: 'next', cursors: { after: 'repeat' } } }
    fetchMock.mockResolvedValueOnce(Response.json(page)).mockResolvedValueOnce(Response.json(page))
    const { GET } = await import('./route')
    const response = await GET()
    expect(response.status).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await expect(response.json()).resolves.toMatchObject({ accounts: [], configured: true })
  })
})
