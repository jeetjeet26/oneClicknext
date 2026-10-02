import {beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const d=vi.hoisted(()=>({auth:vi.fn(),access:vi.fn(),rpc:vi.fn(),lead:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:d.auth}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:d.rpc,from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:d.lead};return q}})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:d.access}))
import {POST} from './route'
const body={leadId:'11111111-1111-4111-8111-111111111111',requestId:'22222222-2222-4222-8222-222222222222',timezone:'America/New_York'}
const post=(data:unknown=body)=>POST(new NextRequest('http://localhost/api/tours/timezone',{method:'POST',body:JSON.stringify(data)}))
beforeEach(()=>{vi.resetAllMocks();d.auth.mockResolvedValue({data:{user:{id:'operator'}}});d.access.mockResolvedValue({authorized:true});d.lead.mockResolvedValue({data:{property_id:'property'}});d.rpc.mockResolvedValue({data:{state:'applied',context:{timezone:'America/New_York'}}})})
it('requires authentication',async()=>{d.auth.mockResolvedValue({data:{user:null}});expect((await post()).status).toBe(401);expect(d.rpc).not.toHaveBeenCalled()})
it('checks property access',async()=>{d.access.mockResolvedValue({authorized:false});expect((await post()).status).toBe(403);expect(d.rpc).not.toHaveBeenCalled()})
it('rejects missing request identity',async()=>{expect((await post({...body,requestId:undefined})).status).toBe(400);expect(d.rpc).not.toHaveBeenCalled()})
it('derives operator and property from trusted context',async()=>{expect((await post({...body,actorId:'forged'})).status).toBe(200);expect(d.rpc).toHaveBeenCalledWith('set_recorded_tour_timezone',{p_actor_id:'operator',p_property_id:'property',p_request_id:body.requestId,p_timezone:body.timezone})})
it.each(['replayed','already_configured'])('returns current context for %s',async state=>{d.rpc.mockResolvedValue({data:{state,context:{timezone:'UTC'}}});expect(await(await post()).json()).toMatchObject({state,context:{timezone:'UTC'}})})
it('does not claim configuration success after database failure',async()=>{d.rpc.mockResolvedValue({error:{message:'offline'}});expect((await post()).status).toBe(500)})
it('does not mutate through an invalid timezone',async()=>{d.rpc.mockResolvedValue({data:{state:'invalid_timezone'}});expect((await post()).status).toBe(409)})

it('accepts property setup without requiring a lead and checks its access',async()=>{
 const propertyId='33333333-3333-4333-8333-333333333333'
 expect((await post({propertyId,requestId:body.requestId,timezone:body.timezone,actorId:'forged'})).status).toBe(200)
 expect(d.lead).not.toHaveBeenCalled();expect(d.access).toHaveBeenCalledWith('operator',propertyId)
 expect(d.rpc).toHaveBeenCalledWith('set_recorded_tour_timezone',expect.objectContaining({p_property_id:propertyId,p_actor_id:'operator'}))
})
it('rejects ambiguous lead and property targets',async()=>{expect((await post({...body,propertyId:'33333333-3333-4333-8333-333333333333'})).status).toBe(400);expect(d.rpc).not.toHaveBeenCalled()})
it('denies property setup outside the operator scope',async()=>{d.access.mockResolvedValue({authorized:false});expect((await post({...body,leadId:undefined,propertyId:'33333333-3333-4333-8333-333333333333'})).status).toBe(403);expect(d.rpc).not.toHaveBeenCalled()})
