import {beforeEach,describe,expect,it,vi} from 'vitest'
import type {NextRequest} from 'next/server'
const getUser=vi.fn(),access=vi.fn(),save=vi.fn(),lookup=vi.fn()
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:()=>({select:()=>({eq:()=>({single:lookup})})})})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyManagerAccess:access}))
vi.mock('@/utils/forgestudio/content-store',async load=>({...await load<typeof import('@/utils/forgestudio/content-store')>(),reviewPublicationRecovery:save}))
const id='11111111-1111-4111-8111-111111111111',params={params:Promise.resolve({publicationId:id})}
const input={requestId:id,expectedUpdatedAt:'2026-09-17T00:00:00Z',action:'record_existing_post',reason:'Reviewed exact destination and post',providerPostId:'post-123',providerPostUrl:'https://example.invalid/post-123'}
const req=(body:unknown)=>new Request('http://localhost/api/forgestudio/publications/'+id+'/recovery',{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}}) as NextRequest
beforeEach(()=>{vi.clearAllMocks();getUser.mockResolvedValue({data:{user:{id:'actual-actor'}},error:null});lookup.mockResolvedValue({data:{property_id:'actual-property'},error:null});access.mockResolvedValue({authorized:true});save.mockResolvedValue({state:'saved'})})
describe('publication recovery boundary',()=>{
 it('requires sign-in before reading evidence',async()=>{getUser.mockResolvedValue({data:{user:null},error:null});expect((await (await import('./route')).POST(req(input),params)).status).toBe(401);expect(lookup).not.toHaveBeenCalled()})
 it('requires current manager access',async()=>{access.mockResolvedValue({authorized:false});expect((await (await import('./route')).POST(req(input),params)).status).toBe(403);expect(save).not.toHaveBeenCalled()})
 it.each([{providerPostId:undefined},{providerPostUrl:undefined},{providerPostUrl:'javascript:alert(1)'},{reason:'short'},{expectedUpdatedAt:undefined},{action:'retry'}])('rejects incomplete or unsafe evidence %j',async change=>{expect((await (await import('./route')).POST(req({...input,...change}),params)).status).toBe(400);expect(save).not.toHaveBeenCalled()})
 it('uses the signed-in reviewer and exact opened publication version',async()=>{expect((await (await import('./route')).POST(req({...input,actorId:'forged-actor'}),params)).status).toBe(200);expect(save).toHaveBeenCalledWith(id,'actual-actor',input)})
 it('propagates a stale saved version as a conflict',async()=>{const {ContentStoreError}=await import('@/utils/forgestudio/content-store');save.mockRejectedValueOnce(new ContentStoreError('Reload the saved result',409));expect((await (await import('./route')).POST(req(input),params)).status).toBe(409)})
})
