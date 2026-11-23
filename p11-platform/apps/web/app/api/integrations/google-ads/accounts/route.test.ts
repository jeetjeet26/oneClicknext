import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const fromMock = vi.fn()
const rpcMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => ({ from: fromMock, rpc: rpcMock }),
}))

describe('integrations google-ads accounts route auth', () => {
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

describe('Google Ads manager discovery', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    rpcMock.mockResolvedValue({ data: null, error: null })
    const user = { id: 'console-operator' }
    vi.stubEnv('P11_OPERATIONS_ADMIN_IDS', user.id)
    vi.stubEnv('GOOGLE_ADS_CUSTOMER_ID', '123-456-7890')
    vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', 'test-developer-token')
    vi.stubEnv('GOOGLE_ADS_CLIENT_ID', 'test-client-id')
    vi.stubEnv('GOOGLE_ADS_CLIENT_SECRET', 'test-secret')
    vi.stubEnv('GOOGLE_ADS_REFRESH_TOKEN', 'test-refresh-token')
    authGetUserMock.mockResolvedValue({ data: { user }, error: null })
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock } })
    fromMock.mockImplementation(table => ({
      select: () => table === 'profiles'
        ? { eq: () => ({ single: async () => ({ data: { org_id: 'p11', role: 'admin' } }) }) }
        : { eq: () => ({ eq: async () => ({ data: [{
          account_id: '5555555555', property_id: 'cayman', properties: { name: 'Cayman' },
        }] }) }) },
    }))
    fetchMock.mockResolvedValueOnce(Response.json({ access_token: 'test-access-token' }))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('loads and deduplicates advertiser accounts from all manager hierarchy pages', async () => {
    const cayman = { customerClient: { id: '5555555555', descriptiveName: 'Cayman' } }
    fetchMock
      .mockResolvedValueOnce(Response.json({ results: [
        cayman, { customerClient: { id: '7777777777', manager: true } },
      ], nextPageToken: 'next-page' }))
      .mockResolvedValueOnce(Response.json({ results: [
        { customerClient: { id: '6666666666', descriptiveName: 'Barton', testAccount: true } }, cayman,
      ] }))

    const { GET } = await import('./route')
    const response = await GET()
    expect(response.status).toBe(200)
    expect(fetchMock.mock.calls.slice(1).map(([url]) => url)).toEqual([
      'https://googleads.googleapis.com/v25/customers/1234567890/googleAds:search',
      'https://googleads.googleapis.com/v25/customers/1234567890/googleAds:search',
    ])
    const options = fetchMock.mock.calls[1][1]
    expect(options.headers['login-customer-id']).toBe('1234567890')
    expect(JSON.parse(options.body).query).toMatch(/FROM customer_client\s+WHERE customer_client.manager = FALSE/)
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).pageToken).toBe('next-page')
    await expect(response.json()).resolves.toMatchObject({
      mcc_id: '123-456-7890',
      accounts: [
        { customer_id: '666-666-6666', linked: false, test_account: true },
        { customer_id: '555-555-5555', linked: true, linked_property_name: 'Cayman' },
      ],
    })
  })

  it('returns an error instead of showing a partial account list when a later page fails', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ results: [{ customerClient: { id: '5555555555' } }], nextPageToken: 'next' }))
      .mockResolvedValueOnce(new Response('private diagnostic', { status: 403 }))
    const { GET } = await import('./route')
    const response = await GET()
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ accounts: [], configured: true })
  })
})
