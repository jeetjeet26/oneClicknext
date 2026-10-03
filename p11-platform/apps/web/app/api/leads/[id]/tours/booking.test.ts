import {beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const d=vi.hoisted(()=>({auth:vi.fn(),access:vi.fn(),rpc:vi.fn(),lead:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:d.auth}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:d.rpc,from:()=>{const q={select:()=>q,eq:()=>q,single:d.lead};return q}})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:d.access}))
vi.mock('@/utils/services/delivery-guard',()=>({isDeliveryPaused:()=>true}))
import {POST} from './route'
const requestId='11111111-1111-4111-8111-111111111111',body={requestId,tourDate:'2099-01-01',tourTime:'10:00',sendConfirmation:true}
const post=(data:unknown=body)=>POST(new NextRequest('http://localhost/api/leads/lead/tours',{method:'POST',body:JSON.stringify(data)}),{params:Promise.resolve({id:'lead'})})
beforeEach(()=>{vi.resetAllMocks();d.auth.mockResolvedValue({data:{user:{id:'operator'}}});d.access.mockResolvedValue({authorized:true});d.lead.mockResolvedValue({data:{property_id:'property'}});d.rpc.mockResolvedValue({data:{state:'applied',tour:{id:'tour'},actionEventId:requestId,confirmation:'queued'}})})
it('authenticates before booking',async()=>{d.auth.mockResolvedValue({data:{user:null}});expect((await post()).status).toBe(401);expect(d.rpc).not.toHaveBeenCalled()})
it('requires property access before mutation',async()=>{d.access.mockResolvedValue({authorized:false});expect((await post()).status).toBe(403);expect(d.rpc).not.toHaveBeenCalled()})
it.each([{...body,requestId:undefined},{...body,tourDate:'2099-02-30'},{...body,tourTime:'25:00'},{...body,tourType:'invented'},{...body,notes:'x'.repeat(2001)}])('validates the booking before writing',async data=>{expect((await post(data)).status).toBe(400);expect(d.rpc).not.toHaveBeenCalled()})
it('pins authenticated scope and clearly reports queued paused delivery',async()=>{
 const response=await post({...body,actorId:'attacker',propertyId:'other'});expect(response.status).toBe(201);expect(await response.json()).toMatchObject({confirmation:'queued',deliveryPaused:true})
 expect(d.rpc).toHaveBeenCalledWith('book_recorded_console_tour',expect.objectContaining({p_actor_id:'operator',p_property_id:'property',p_lead_id:'lead',p_request_id:requestId}))
})
it.each(['unavailable','needs_timezone','ambiguous_time','not_future','date_out_of_range','invalid_agent','request_conflict'])('returns %s without a false booking success',async state=>{d.rpc.mockResolvedValue({data:{state}});expect((await post()).status).toBe(409)})
it('reports lost persistence acknowledgement as unconfirmed',async()=>{d.rpc.mockResolvedValue({error:{message:'lost response'}});expect((await post()).status).toBe(500)})
it('recovers the saved booking without claiming a new reservation',async()=>{d.rpc.mockResolvedValue({data:{state:'replayed',tour:{id:'tour',status:'cancelled'},actionEventId:requestId,confirmation:'not_sent'}});const r=await post();expect(r.status).toBe(200);expect(await r.json()).toMatchObject({state:'replayed',tour:{status:'cancelled'},confirmation:'not_sent'})})
