import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authGetUser = vi.fn()
const validateAccess = vi.fn()
const validateManagerAccess = vi.fn()
const serviceFrom = vi.fn()
const rpc = vi.fn()

vi.mock('@/utils/brandforge/operations', async () => ({ ...(await vi.importActual<typeof import('@/utils/brandforge/operations')>('@/utils/brandforge/operations')), brandRpc: rpc }))

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: authGetUser } })),
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(() => ({ from: serviceFrom })),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validateAccess,
  validatePropertyManagerAccess: validateManagerAccess,
}))
vi.mock('@/utils/services/request-context', () => ({
  createRequestContext: () => ({
    responseHeaders: { 'X-Request-Id': 'brand-assets-request' },
    logStart: vi.fn(),
    logSuccess: vi.fn(),
    logError: vi.fn(),
  }),
}))
vi.mock('@/utils/storage/asset-service', () => ({
  STORAGE_BUCKETS: { PROPERTY_ASSETS: 'property-assets' },
  uploadFileAsset: vi.fn(),
}))

const PROPERTY_ID = '33333333-3333-3333-3333-333333333333'
const ASSET_ID = '44444444-4444-4444-8444-444444444444'

function assetListQuery(result:unknown={data:[],error:null,count:0}) {
  const chain:Record<string,unknown>={}
  for(const key of ['select','eq','order','limit','lt','or','is','ilike'])chain[key]=vi.fn(()=>chain)
  chain.then=(resolve:(value:unknown)=>void)=>Promise.resolve(result).then(resolve)
  chain.maybeSingle=vi.fn(async()=>result)
  return chain
}

describe('/api/brandforge/content-assets property identity validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validateAccess.mockResolvedValue({ authorized: true, orgId: 'org-1' })
    validateManagerAccess.mockResolvedValue({ authorized: true, orgId: 'org-1' })
    serviceFrom.mockReturnValue(assetListQuery())
    rpc.mockResolvedValue({state:'applied',assetId:ASSET_ID,revision:2})
  })

  it('accepts a valid Postgres UUID property identifier', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest(
        `http://localhost/api/brandforge/content-assets?propertyId=${PROPERTY_ID}`
      )
    )

    expect(response.status).toBe(200)
    expect(validateAccess).toHaveBeenCalledWith('user-1', PROPERTY_ID)
  })

  it('retains strict generated UUID validation for asset identifiers', async () => {
    const { PATCH } = await import('./route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/brandforge/content-assets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json',origin:'http://localhost' },
        body: JSON.stringify({
          propertyId: PROPERTY_ID,
          assetId: '44444444-4444-4444-4444-444444444444',
          approvalStatus: 'approved',
          rightsStatus: 'owned',
        }),
      })
    )

    expect(response.status).toBe(400)
    expect(validateManagerAccess).not.toHaveBeenCalled()
  })

  it('curates a rights-cleared brand asset when a manager approves it', async () => {
    const query: Record<string, ReturnType<typeof vi.fn>> = {
      update: vi.fn(),
      eq: vi.fn(),
      select: vi.fn(),
      single: vi.fn(),
    }
    query.update.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    query.select.mockReturnValue(query)
    query.single.mockResolvedValue({
      data: {
        id: ASSET_ID,
        approval_status: 'approved',
        curation_status: 'approved',
      },
      error: null,
    })
    serviceFrom.mockReturnValue(query)

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/brandforge/content-assets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json',origin:'http://localhost' },
        body: JSON.stringify({
          propertyId: PROPERTY_ID,
          assetId: ASSET_ID,
          requestId: '55555555-5555-4555-8555-555555555555',
          revision: 1,
          approvalStatus: 'approved',
          rightsStatus: 'generated',
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(query.update).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('review_brand_asset', expect.objectContaining({ p_revision: 1, p_review: { approvalStatus: 'approved', rightsStatus: 'generated' } }))
  })
  it('holds a stale rights decision without returning an asset', async () => {
    rpc.mockResolvedValue({state:'stale'})
    const { PATCH } = await import('./route')
    const response = await PATCH(new NextRequest('http://localhost/api/brandforge/content-assets', { method:'PATCH', headers:{origin:'http://localhost'}, body:JSON.stringify({propertyId:PROPERTY_ID,assetId:ASSET_ID,requestId:'55555555-5555-4555-8555-555555555555',revision:1,approvalStatus:'approved',rightsStatus:'owned'}) }))
    expect(response.status).toBe(409);expect((await response.json()).error).toContain('asset changed')
    expect(serviceFrom).not.toHaveBeenCalled()
  })
  it('refuses non-manager rights decisions before executing a command', async () => {
    validateManagerAccess.mockResolvedValue({authorized:false})
    const { PATCH } = await import('./route')
    const response = await PATCH(new NextRequest('http://localhost/api/brandforge/content-assets', { method:'PATCH', headers:{origin:'http://localhost'}, body:JSON.stringify({propertyId:PROPERTY_ID,assetId:ASSET_ID,requestId:'55555555-5555-4555-8555-555555555555',revision:1,approvalStatus:'approved',rightsStatus:'owned'}) }))
    expect(response.status).toBe(403);expect(rpc).not.toHaveBeenCalled()
  })
})

describe('brand library coverage and recovery',()=>{
 beforeEach(()=>{vi.clearAllMocks();authGetUser.mockResolvedValue({data:{user:{id:'user-1'}},error:null});validateAccess.mockResolvedValue({authorized:true});validateManagerAccess.mockResolvedValue({authorized:true});serviceFrom.mockReturnValue(assetListQuery())})
 it('returns a continuation and full remaining count instead of an implicit first thousand',async()=>{const rows=Array.from({length:31},(_,n)=>({id:ASSET_ID,name:'Asset '+n,created_at:'2026-09-24T00:00:00Z'}));serviceFrom.mockReturnValue(assetListQuery({data:rows,count:1033,error:null}));const{GET}=await import('./route');const r=await GET(new NextRequest('http://localhost/api/brandforge/content-assets?propertyId='+PROPERTY_ID));const d=await r.json();expect(r.status).toBe(200);expect(d.assets).toHaveLength(30);expect(d.remainingCount).toBe(1033);expect(d.nextCursor).toBeTruthy();expect(r.headers.get('cache-control')).toBe('private, no-store')})
 it('rejects malformed cursors without an unbounded fallback',async()=>{const{GET}=await import('./route');const r=await GET(new NextRequest('http://localhost/api/brandforge/content-assets?propertyId='+PROPERTY_ID+'&cursor=invalid'));expect(r.status).toBe(400)})
 it('scopes recovered reviews to the actual actor and property',async()=>{const q=assetListQuery({data:{id:ASSET_ID,result:{revision:2}},error:null});serviceFrom.mockReturnValue(q);const{GET}=await import('./route');const r=await GET(new NextRequest('http://localhost/api/brandforge/content-assets?propertyId='+PROPERTY_ID+'&mode=decision&requestId='+ASSET_ID));expect(r.status).toBe(200);expect(q.eq).toHaveBeenCalledWith('actor_id','user-1');expect(q.eq).toHaveBeenCalledWith('property_id',PROPERTY_ID);expect(q.eq).toHaveBeenCalledWith('action','brand.asset.reviewed')})
 it('pages exact private version snapshots',async()=>{const q=assetListQuery({data:Array.from({length:31},(_,i)=>({revision:100-i,snapshot:{}})),error:null});serviceFrom.mockReturnValue(q);const{GET}=await import('./route');const r=await GET(new NextRequest('http://localhost/api/brandforge/content-assets?propertyId='+PROPERTY_ID+'&mode=history&assetId='+ASSET_ID+'&before=101'));expect((await r.json()).nextRevision).toBe(71);expect(q.lt).toHaveBeenCalledWith('revision',101)})
 it('escapes literal wildcard search characters',async()=>{const q=assetListQuery();serviceFrom.mockReturnValue(q);const{GET}=await import('./route');await GET(new NextRequest('http://localhost/api/brandforge/content-assets?propertyId='+PROPERTY_ID+'&search=100%25_logo'));expect(q.ilike).toHaveBeenCalledWith('name','%100\\%\\_logo%')})
 it('holds cross-origin review before any saved decision',async()=>{const{PATCH}=await import('./route');const r=await PATCH(new NextRequest('http://localhost/api/brandforge/content-assets',{method:'PATCH',headers:{origin:'https://outside.invalid'},body:'{}'}));expect(r.status).toBe(403);expect(rpc).not.toHaveBeenCalled()})
 it('shows a failed read instead of an empty library',async()=>{serviceFrom.mockReturnValue(assetListQuery({data:null,error:{message:'unavailable'},count:null}));const{GET}=await import('./route');const r=await GET(new NextRequest('http://localhost/api/brandforge/content-assets?propertyId='+PROPERTY_ID));expect(r.status).toBe(503)})
})
