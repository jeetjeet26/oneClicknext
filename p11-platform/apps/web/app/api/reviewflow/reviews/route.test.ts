import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

describe('reviewflow reviews route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn(),
    })
  })

  it('returns 401 for GET when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/reviewflow/reviews?propertyId=33333333-3333-3333-3333-333333333333') as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('retires direct review writes in favor of reviewed saved imports',async()=>{const {POST,PATCH,DELETE}=await import('./route');for(const handler of [POST,PATCH,DELETE])expect((await handler()).status).toBe(410)})
})

describe('bounded full-property review search',()=>{
 const propertyId='33333333-3333-3333-3333-333333333333'
 function chain(){const q={select:vi.fn(),eq:vi.fn(),order:vi.fn(),range:vi.fn(),in:vi.fn(),then:vi.fn()};for(const key of ['select','eq','order','range','in'] as const)q[key].mockReturnValue(q);q.then.mockImplementation((r:(v:unknown)=>unknown)=>Promise.resolve({data:[],count:0,error:null}).then(r));return q}
 it('keeps literal text in a typed search argument and preserves exact property scope',async()=>{const q=chain(),rpc=vi.fn().mockReturnValue(q);createClientMock.mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:'actor'}},error:null})},rpc});validatePropertyAccessMock.mockResolvedValue({authorized:true});const text='100% _ * commas, "quotes"';const {GET}=await import('./route');const r=await GET(new Request(`http://localhost/api/reviewflow/reviews?propertyId=${propertyId}&search=${encodeURIComponent(text)}`) as NextRequest);expect(r.status).toBe(200);expect(rpc).toHaveBeenCalledWith('search_reviewflow_reviews',{p_property_id:propertyId,p_query:text},{count:'exact'});expect(q.eq).toHaveBeenCalledWith('property_id',propertyId);expect(q.select.mock.calls[0][0]).not.toMatch(/raw_data|api_key|access_token|\*/);expect(q.range).toHaveBeenCalledWith(0,49)})
 it('rejects invalid page limits, offsets and overlong search before reading reviews',async()=>{const from=vi.fn();createClientMock.mockResolvedValue({from});const {GET}=await import('./route');for(const params of ['limit=0','limit=201','offset=-1','limit=20rows','search='+'a'.repeat(201)])expect((await GET(new Request(`http://localhost/api/reviewflow/reviews?propertyId=${propertyId}&${params}`) as NextRequest)).status).toBe(400);expect(from).not.toHaveBeenCalled()})
 it('does not run scoped search when property access is denied',async()=>{const rpc=vi.fn();createClientMock.mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:'actor'}},error:null})},rpc});validatePropertyAccessMock.mockResolvedValue({authorized:false});const {GET}=await import('./route');expect((await GET(new Request(`http://localhost/api/reviewflow/reviews?propertyId=${propertyId}&search=text`) as NextRequest)).status).toBe(403);expect(rpc).not.toHaveBeenCalled()})
})
