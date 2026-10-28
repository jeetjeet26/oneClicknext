import { describe,it,expect,vi,beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { PackageError } from '@/utils/siteforge/packages/contracts'
const mocks=vi.hoisted(()=>({operator:vi.fn(),save:vi.fn(),get:vi.fn(),source:vi.fn(),process:vi.fn()}))
vi.mock('next/server',async original=>({...await original<typeof import('next/server')>(),after:vi.fn()}))
vi.mock('@/utils/siteforge/packages/store',()=>({requirePackageOperator:mocks.operator,savePackageRequest:mocks.save,getPackageJob:mocks.get,packageDb:vi.fn()}))
vi.mock('@/utils/siteforge/packages/source',()=>({loadPackageSource:mocks.source,sha256:vi.fn()}))
vi.mock('@/utils/siteforge/packages/runner',()=>({processPackage:mocks.process}))
import { GET,POST } from './route'
const propertyId='33333333-3333-4333-8333-333333333333',id='44444444-4444-4444-8444-444444444444'
const post=(body:unknown)=>new NextRequest('http://localhost/api/siteforge/packages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
describe('package API authorization',()=>{
  beforeEach(()=>vi.resetAllMocks())
  it('rejects unauthenticated reads before loading saved property information',async()=>{
    mocks.operator.mockRejectedValue(new PackageError('Sign in',401))
    expect((await GET(new NextRequest(`http://localhost/api/siteforge/packages?propertyId=${propertyId}`))).status).toBe(401)
    expect(mocks.source).not.toHaveBeenCalled()
  })
  it('rejects a client or other-property operator before any generation or refresh',async()=>{
    mocks.operator.mockRejectedValue(new PackageError('Forbidden',403))
    expect((await POST(post({action:'generate',requestId:id,propertyId,target:'standalone',instructions:'Build'}))).status).toBe(403)
    expect(mocks.save).not.toHaveBeenCalled();expect(mocks.process).not.toHaveBeenCalled()
  })
  it('scopes a download lookup to the authorized property and rejects a foreign package',async()=>{
    mocks.operator.mockResolvedValue({id:'actor',orgId:'allowed-org'})
    mocks.get.mockResolvedValue({org_id:'other-org',state:'ready'})
    expect((await POST(post({action:'download',id,propertyId}))).status).toBe(404)
    expect(mocks.get).toHaveBeenCalledWith(id,propertyId)
  })
  it('preserves the selected parent when requesting an edit instead of silently using the latest package',async()=>{
    const parentId='55555555-5555-4555-8555-555555555555'
    mocks.operator.mockResolvedValue({id:'actor',orgId:'allowed-org'})
    mocks.save.mockResolvedValue({id,state:'queued'})
    const response=await POST(post({action:'generate',requestId:id,propertyId,parentId,target:'wordpress',instructions:'Shorten the Community introduction. Keep other pages unchanged.'}))
    expect(response.status).toBe(202)
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({parentId,target:'wordpress',propertyId}),expect.objectContaining({id:'actor'}))
  })
  it('rejects malformed requests without invoking any provider',async()=>{
    expect((await POST(post({action:'generate',propertyId,requestId:id,target:'codex',instructions:'Build'}))).status).toBe(400)
    expect(mocks.operator).not.toHaveBeenCalled();expect(mocks.process).not.toHaveBeenCalled()
  })
  it('enforces the same private scope for native browser downloads',async()=>{
    mocks.operator.mockResolvedValue({id:'actor',orgId:'allowed-org'})
    mocks.get.mockResolvedValue({org_id:'other-org',state:'ready'})
    expect((await GET(new NextRequest(`http://localhost/api/siteforge/packages?propertyId=${propertyId}&downloadId=${id}`))).status).toBe(404)
    expect(mocks.get).toHaveBeenCalledWith(id,propertyId)
  })
})
