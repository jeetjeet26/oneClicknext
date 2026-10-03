import {beforeEach,describe,expect,it,vi} from 'vitest'
import type {NextRequest} from 'next/server'
const getUser=vi.fn(),access=vi.fn(),load=vi.fn(),refresh=vi.fn(),lookup=vi.fn()
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:lookup})})})})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:access}))
vi.mock('@/utils/forgestudio/source-store',()=>({getSourceReview:load,refreshSourceReview:refresh}))
const id='11111111-1111-4111-8111-111111111111',params={params:Promise.resolve({packageId:id})},url='http://localhost/api/forgestudio/packages/'+id+'/sources'
const body={requestId:id,expectedRevisionId:id,previewHash:'a'.repeat(64),reason:'Corrected price using current inventory',content:{conceptSummary:'Community',variants:[{platform:'facebook',caption:'Welcome'}]}}
const req=(data:unknown=body)=>new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}) as NextRequest
beforeEach(()=>{vi.clearAllMocks();getUser.mockResolvedValue({data:{user:{id:'actual-actor'}},error:null});lookup.mockResolvedValue({data:{property_id:'property',org_id:'org'},error:null});access.mockResolvedValue({authorized:true,orgId:'org'});load.mockResolvedValue({state:'current'});refresh.mockResolvedValue({state:'saved'})})
describe('source review API',()=>{
 it('requires sign-in for source reads and mutations',async()=>{getUser.mockResolvedValue({data:{user:null},error:null});const r=await import('./route');expect((await r.GET(req(),params)).status).toBe(401);expect((await r.POST(req(),params)).status).toBe(401);expect(load).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled()})
 it('rejects stale organization scope',async()=>{access.mockResolvedValue({authorized:true,orgId:'other'});const r=await import('./route');expect((await r.GET(req(),params)).status).toBe(403);expect((await r.POST(req(),params)).status).toBe(403);expect(refresh).not.toHaveBeenCalled()})
 it('uses the authenticated actor and the actual campaign property',async()=>{expect((await(await import('./route')).POST(req({...body,actorId:'forged',propertyId:'forged'}),params)).status).toBe(201);expect(refresh).toHaveBeenCalledWith(expect.objectContaining({actorId:'actual-actor',propertyId:'property',packageId:id,previewHash:body.previewHash}))})
 it.each(['requestId','expectedRevisionId','previewHash','reason'])('requires %s for a reviewed refresh',async key=>{const invalid={...body,[key]:undefined};expect((await(await import('./route')).POST(req(invalid),params)).status).toBe(400);expect(refresh).not.toHaveBeenCalled()})
 it('source read failures stay explicit and do not return an empty success',async()=>{load.mockRejectedValue(new Error('database failed'));expect((await(await import('./route')).GET(req(),params)).status).toBe(503)})
})
