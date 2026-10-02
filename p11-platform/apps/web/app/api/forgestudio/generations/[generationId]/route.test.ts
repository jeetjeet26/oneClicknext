import {beforeEach,describe,expect,it,vi} from 'vitest'
import type {NextRequest} from 'next/server'
const getUser=vi.fn(),access=vi.fn(),recover=vi.fn(),rpc=vi.fn(),lookup=vi.fn()
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:()=>({select:()=>({eq:()=>({single:lookup})})})})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:access}))
vi.mock('@/utils/forgestudio/generation-store',()=>({recoverGeneration:recover,generationRpc:rpc}))
const id='11111111-1111-4111-8111-111111111111',params={params:Promise.resolve({generationId:id})}
const req=(body:unknown)=>new Request('http://localhost/api/forgestudio/generations/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}) as NextRequest
beforeEach(()=>{vi.clearAllMocks();getUser.mockResolvedValue({data:{user:{id:'actual-user'}},error:null});lookup.mockResolvedValue({data:{property_id:'property',org_id:'organization'},error:null});access.mockResolvedValue({authorized:true,orgId:'organization'});recover.mockResolvedValue({state:'saved',packageId:'package',revisionId:'revision'});rpc.mockResolvedValue({state:'saved'})})
describe('generation recovery and stop API',()=>{
 it('requires sign-in',async()=>{getUser.mockResolvedValue({data:{user:null},error:null});expect((await (await import('./route')).POST(req({requestId:id,action:'recover'}),params)).status).toBe(401);expect(recover).not.toHaveBeenCalled()})
 it('requires current organization scope',async()=>{access.mockResolvedValue({authorized:true,orgId:'other'});expect((await (await import('./route')).POST(req({requestId:id,action:'recover'}),params)).status).toBe(403);expect(recover).not.toHaveBeenCalled()})
 it('binds recovery to the actual reviewer and stable decision identity',async()=>{expect((await (await import('./route')).POST(req({requestId:id,action:'recover',actorId:'forged'}),params)).status).toBe(200);expect(recover).toHaveBeenCalledWith(id,'property','actual-user',id)})
 it.each([{action:'stop',requestId:id},{action:'stop',requestId:id,expectedUpdatedAt:'2026-09-17T00:00:00Z',reason:'short'},{action:'retry',requestId:id}])('rejects incomplete or implicit resend decisions %j',async body=>{expect((await (await import('./route')).POST(req(body),params)).status).toBe(400);expect(rpc).not.toHaveBeenCalled();expect(recover).not.toHaveBeenCalled()})
 it('passes the exact opened version and reason to the stop transaction',async()=>{const body={requestId:id,action:'stop',expectedUpdatedAt:'2026-09-17T00:00:00Z',reason:'Stop this uncertain request before changing the brief'};expect((await (await import('./route')).POST(req(body),params)).status).toBe(200);expect(rpc).toHaveBeenCalledWith('stop_forgestudio_generation',{p_id:id,p_property_id:'property',p_actor_id:'actual-user',p_payload:{generationId:id,expectedUpdatedAt:body.expectedUpdatedAt,reason:body.reason}})})
})
