import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const rpcMock = vi.fn()
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:rpcMock}),createAdminClient:()=>({})}))
const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
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

describe('community knowledge-sources route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpcMock.mockResolvedValue({data:{state:'forbidden'},error:null})
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/community/knowledge-sources?propertyId=33333333-3333-3333-3333-333333333333'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('GET returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/community/knowledge-sources?propertyId=33333333-3333-3333-3333-333333333333'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })
})

it('keeps complete native totals separate from the returned page',async()=>{authGetUserMock.mockResolvedValue({data:{user:{id:'actor'}},error:null});rpcMock.mockResolvedValue({data:{state:'ready',propertyId:'33333333-3333-3333-3333-333333333333',items:[],total:1051,nextOffset:20,summary:{sourceCount:1051,chunkCount:2052,documentGroups:29,hasWebsiteSources:true}},error:null});const{GET}=await import('./route');const r=await GET(new Request('http://local/api/read?propertyId=33333333-3333-3333-3333-333333333333')as NextRequest);expect(r.status).toBe(200);expect(await r.json()).toMatchObject({total:1051,nextOffset:20})})
