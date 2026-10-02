import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), createClient: vi.fn(), access: vi.fn(), from: vi.fn() }))
vi.mock('@/utils/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/utils/services/auth-guard', () => ({ validatePropertyAccess: mocks.access }))
import { GET } from './route'

const propertyId = '33333333-3333-3333-3333-333333333333'
function query(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve),
  }
  for (const fn of [builder.select, builder.eq, builder.order, builder.limit]) fn.mockReturnValue(builder)
  return builder
}
function request(id: string | null = propertyId) {
  return new NextRequest(`http://localhost/api/pipelines${id === null ? '' : `?property_id=${id}`}`)
}

describe('property pipeline records', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.auth }, from: mocks.from })
    mocks.access.mockResolvedValue({ authorized: true })
    mocks.from.mockImplementation(() => query([]))
  })

  it('rejects unauthenticated callers before any property or record query', async () => {
    mocks.auth.mockResolvedValue({ data: { user: null }, error: null })
    expect((await GET(request())).status).toBe(401)
    expect(mocks.access).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it.each([null, 'invalid', 'property-a,property-b'])('rejects invalid property input %s', async id => {
    expect((await GET(request(id))).status).toBe(400)
    expect(mocks.access).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects another organization before querying records', async () => {
    mocks.access.mockResolvedValue({ authorized: false })
    expect((await GET(request())).status).toBe(403)
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith('user-1', propertyId)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('scopes both RLS queries, bounds history, excludes provider metadata, and disables caching', async () => {
    const connections = query([{ id: 'account-1', platform: 'meta_ads' }])
    const runs = query([{ id: 'job-1', status: 'failed' }])
    mocks.from.mockImplementation(table => table === 'import_jobs' ? runs : connections)
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(connections.eq).toHaveBeenCalledExactlyOnceWith('property_id', propertyId)
    expect(runs.eq).toHaveBeenCalledExactlyOnceWith('property_id', propertyId)
    expect(runs.limit).toHaveBeenCalledExactlyOnceWith(50)
    expect(connections.select.mock.calls[0][0]).not.toMatch(/\*|metadata|account_id|org_id/)
    expect(await response.json()).toMatchObject({ property_id: propertyId, runs: [{ id: 'job-1', status: 'failed' }], history_limit: 50 })
  })

  it.each(['ad_account_connections', 'import_jobs'])('never converts a failed %s query to an empty result', async failedTable => {
    mocks.from.mockImplementation(table => query(table === failedTable ? null : [], table === failedTable ? { message: 'private schema detail' } : null))
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private schema detail')
  })

  it('handles unexpected database exceptions without exposing internals', async () => {
    mocks.from.mockImplementation(() => { throw new Error('private host credential') })
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private host credential')
  })
})
