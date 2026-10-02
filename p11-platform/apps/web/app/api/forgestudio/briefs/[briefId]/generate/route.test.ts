import {beforeEach,describe,expect,it,vi} from 'vitest'
import type {NextRequest} from 'next/server'
const getUser=vi.fn(),access=vi.fn(),run=vi.fn(),lookup=vi.fn()
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:()=>({select:()=>({eq:()=>({single:lookup})})})})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:access}))
vi.mock('@/utils/forgestudio/generation-store',()=>({runBriefGeneration:run}))
const id='11111111-1111-4111-8111-111111111111',params={params:Promise.resolve({briefId:id})}
const req=(body:unknown)=>new Request('http://localhost/api/forgestudio/briefs/'+id+'/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}) as NextRequest
beforeEach(()=>{vi.clearAllMocks();getUser.mockResolvedValue({data:{user:{id:'actual-user'}},error:null});lookup.mockResolvedValue({data:{property_id:'property',org_id:'organization'},error:null});access.mockResolvedValue({authorized:true,orgId:'organization'});run.mockResolvedValue({state:'saved',packageId:'package',revisionId:'revision'})})
describe('durable generation API',()=>{
 it('requires sign-in',async()=>{getUser.mockResolvedValue({data:{user:null},error:null});expect((await (await import('./route')).POST(req({requestId:id}),params)).status).toBe(401);expect(run).not.toHaveBeenCalled()})
 it('requires the saved request identity before any generation',async()=>{expect((await (await import('./route')).POST(req({}),params)).status).toBe(400);expect(run).not.toHaveBeenCalled()})
 it.each([{authorized:false},{authorized:true,orgId:'other-org'}])('rejects unauthorized scope %j',async permissions=>{access.mockResolvedValue(permissions);expect((await (await import('./route')).POST(req({requestId:id}),params)).status).toBe(403);expect(run).not.toHaveBeenCalled()})
 it('uses the current actor and saved brief property',async()=>{expect((await (await import('./route')).POST(req({requestId:id,actorId:'forged',propertyId:'forged'}),params)).status).toBe(201);expect(run).toHaveBeenCalledWith({requestId:id,briefId:id,actorId:'actual-user',propertyId:'property'})})
 it.each(['preparing','ready','generating','result_ready','busy'])('returns %s as pending instead of false success',async state=>{run.mockResolvedValue({state});const result=await (await import('./route')).POST(req({requestId:id}),params);expect(result.status).toBe(202);expect((await result.json()).error).toMatch(/no second model run/)})
 it('surfaces an uncertain orchestration error without issuing a new request',async()=>{run.mockRejectedValue(new Error('lost response'));expect((await (await import('./route')).POST(req({requestId:id}),params)).status).toBe(503);expect(run).toHaveBeenCalledOnce()})
})
