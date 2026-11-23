import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const d = vi.hoisted(() => ({
  getUser: vi.fn(), from: vi.fn(), userFrom: vi.fn(), fetch: vi.fn(), audit: vi.fn(), manage: vi.fn(),
}))
vi.mock('@/utils/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: d.getUser }, from: d.userFrom }) }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient: () => ({ from: d.from }) }))
vi.mock('@/utils/audit', () => ({ logAuditEvent: d.audit }))
vi.mock('@/utils/services/auth-guard', () => ({ validatePropertyManagerAccess: d.manage }))
import { GET as metaAccounts } from '@/app/api/integrations/meta-ads/accounts/route'
import { GET as googleAccounts } from '@/app/api/integrations/google-ads/accounts/route'
import { GET as listConnections, POST as connectAccount, DELETE as deleteConnection, PATCH as updateConnection } from '@/app/api/integrations/ad-connections/route'

const actor = '11111111-1111-4111-8111-111111111111'
const property = '22222222-2222-4222-8222-222222222222'
let role = 'admin'
let inserted: unknown[] = []
let mutations: unknown[] = []
let savedConnection: Record<string, unknown> | null = null
let selections: { table: string; columns: string }[] = []
function connectionRequest() {
  return new NextRequest('http://localhost/api/integrations/ad-connections', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ property_id: property, platform: 'meta_ads', account_id: '9999999999' }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  role = 'admin'
  inserted = []
  mutations = []
  savedConnection = null
  selections = []
  vi.stubEnv('P11_OPERATIONS_ADMIN_IDS', '')
  vi.stubEnv('META_ACCESS_TOKEN', 'fake-private-meta-token')
  vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', 'fake-developer-token')
  vi.stubEnv('GOOGLE_ADS_CUSTOMER_ID', '1234567890')
  vi.stubEnv('GOOGLE_ADS_CLIENT_ID', 'fake-client-id')
  vi.stubEnv('GOOGLE_ADS_CLIENT_SECRET', 'fake-client-secret')
  vi.stubEnv('GOOGLE_ADS_REFRESH_TOKEN', 'fake-refresh-token')
  d.getUser.mockResolvedValue({ data: { user: { id: actor } }, error: null })
  d.manage.mockResolvedValue({ authorized: true, orgId: 'tenant-a' })
  function query(table: string) {
    let inserting = false
    const result = () => ({ data: table === 'profiles' ? { org_id: 'tenant-a', role }
      : table === 'properties' ? { id: property, name: 'Own property', org_id: 'tenant-a' }
      : inserting ? { id: 'connection-id' } : savedConnection, error: null })
    const q: Record<string, unknown> = {}
    q.select = vi.fn((columns: string) => { selections.push({ table, columns }); return q })
    q.eq = vi.fn(() => q)
    q.single = vi.fn(async () => result())
    q.insert = vi.fn((value: unknown) => { inserting = true; inserted.push(value); return q })
    q.update = vi.fn((value: unknown) => { mutations.push(value); return q })
    q.delete = vi.fn(() => { mutations.push('delete'); return q })
    q.order = vi.fn(async () => ({ data: savedConnection ? [savedConnection] : [], error: null }))
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve)
    return q
  }
  d.from.mockImplementation(query)
  d.userFrom.mockImplementation(query)
  d.fetch.mockImplementation(async (input: string | URL) => {
    if (String(input).includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'fake-google-access' })
    if (String(input).includes('googleAds:search')) return Response.json({ results: [{ customerClient: { id: '9999999999', descriptiveName: 'Other client ad account' } }] })
    return Response.json({ data: [{ id: 'act_9999999999', name: 'Other client ad account', amount_spent: '42000' }] })
  })
  vi.stubGlobal('fetch', d.fetch)
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('shared advertising credentials remain platform-scoped', () => {
  it.each([['Meta', metaAccounts], ['Google', googleAccounts]] as const)('denies a tenant admin global %s account discovery before using provider credentials', async (_name, list) => {
    const response = await list()
    expect(response.status).toBe(403)
    expect(d.fetch).not.toHaveBeenCalled()
  })

  it('denies an ordinary tenant admin claiming a shared-token account', async () => {
    const response = await connectAccount(connectionRequest())
    expect(response.status).toBe(403)
    expect(inserted).toEqual([])
  })

  it.each([['Meta', metaAccounts], ['Google', googleAccounts]] as const)('requires the admin role even for an allowlisted %s user', async (_name, list) => {
    role = 'manager'
    vi.stubEnv('P11_OPERATIONS_ADMIN_IDS', actor)
    expect((await list()).status).toBe(403)
    expect(d.fetch).not.toHaveBeenCalled()
  })

  it('allows an explicitly configured operator to discover Meta accounts without a token in the URL', async () => {
    vi.stubEnv('P11_OPERATIONS_ADMIN_IDS', ` another-operator, ${actor} `)
    const response = await metaAccounts()
    expect(response.status).toBe(200)
    const [url, options] = d.fetch.mock.calls[0]
    expect(String(url)).not.toContain('fake-private-meta-token')
    expect(options.headers.Authorization).toBe('Bearer fake-private-meta-token')
    expect(options.redirect).toBe('error')
  })

  it('allows an explicitly configured operator to discover Google accounts', async () => {
    vi.stubEnv('P11_OPERATIONS_ADMIN_IDS', actor)
    expect((await googleAccounts()).status).toBe(200)
    expect(d.fetch).toHaveBeenCalledTimes(2)
  })

  it('still requires a current property management grant for operator provisioning', async () => {
    vi.stubEnv('P11_OPERATIONS_ADMIN_IDS', actor)
    d.manage.mockResolvedValue({ authorized: false })
    expect((await connectAccount(connectionRequest())).status).toBe(403)
    expect(inserted).toEqual([])
  })

  it('allows reviewed provisioning by an operator with property access', async () => {
    vi.stubEnv('P11_OPERATIONS_ADMIN_IDS', actor)
    expect((await connectAccount(connectionRequest())).status).toBe(201)
    expect(d.manage).toHaveBeenCalledWith(actor, property)
    expect(inserted).toHaveLength(1)
  })

  it('keeps RLS on saved connection lists and excludes provider metadata', async () => {
    expect((await listConnections(new NextRequest('http://localhost/api/integrations/ad-connections'))).status).toBe(200)
    expect(d.from).not.toHaveBeenCalled()
    expect(d.userFrom).toHaveBeenCalledWith('ad_account_connections')
    const columns = selections.find(s => s.table === 'ad_account_connections')!.columns
    expect(columns).not.toMatch(/\*|metadata|last_error|last_sync_error/)
  })

  it.each(['DELETE', 'PATCH'])('blocks %s for a same-org manager without current community access', async method => {
    role = 'manager'
    savedConnection = { id: 'connection-id', property_id: property }
    d.manage.mockResolvedValue({ authorized: false })
    const request = new NextRequest('http://localhost/api/integrations/ad-connections?id=connection-id', {
      method, ...(method === 'PATCH' ? { body: JSON.stringify({ id: 'connection-id', is_active: false }) } : {}),
    })
    const response = await (method === 'DELETE' ? deleteConnection : updateConnection)(request)
    expect(response.status).toBe(403)
    expect(mutations).toEqual([])
  })

  it('lets a community manager change activation without reassigning the account', async () => {
    role = 'manager'
    savedConnection = { id: 'connection-id', property_id: property }
    const response = await updateConnection(new NextRequest('http://localhost/api/integrations/ad-connections', {
      method: 'PATCH', body: JSON.stringify({ id: 'connection-id', is_active: false, account_id: 'attacker-account', property_id: 'attacker-property' }),
    }))
    expect(response.status).toBe(200)
    expect(mutations).toEqual([{ is_active: false, updated_at: expect.any(String) }])
    expect(d.manage).toHaveBeenCalledWith(actor, property)
  })

  it('lets a community manager disconnect an existing provisioned account', async () => {
    role = 'manager'
    savedConnection = { id: 'connection-id', property_id: property, platform: 'meta_ads', account_id: '9999999999' }
    expect((await deleteConnection(new NextRequest('http://localhost/api/integrations/ad-connections?id=connection-id', { method: 'DELETE' }))).status).toBe(200)
    expect(mutations).toEqual(['delete'])
  })
})
