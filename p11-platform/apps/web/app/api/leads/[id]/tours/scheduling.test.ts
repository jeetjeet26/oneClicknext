import {beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const d=vi.hoisted(()=>({auth:vi.fn(),access:vi.fn(),rpc:vi.fn(),from:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:d.auth}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:d.from,rpc:d.rpc})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:d.access}))
vi.mock('@/utils/services/tour-schedule-delivery',()=>({withTourDelivery:vi.fn()}))
vi.mock('@/utils/services/tour-email-generator',()=>({generateTourEmail:vi.fn()}))
vi.mock('@/utils/services/messaging',()=>({sendEmail:vi.fn(),sendMessage:vi.fn()}))
import {PATCH,DELETE} from './route'
const tourId='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222'
const body={tourId,requestId,expectedVersion:1,action:'reschedule',date:'2099-01-01',time:'10:00',reason:'Prospect requested',notify:true}
const call=(data:unknown=body)=>PATCH(new NextRequest('http://localhost/api/leads/lead/tours',{method:'PATCH',body:JSON.stringify(data)}),{params:Promise.resolve({id:'lead'})})
beforeEach(()=>{
 vi.resetAllMocks();d.auth.mockResolvedValue({data:{user:{id:'operator'}},error:null});d.access.mockResolvedValue({authorized:true})
 d.from.mockImplementation((table:string)=>{const q={select:()=>q,eq:()=>q,single:async()=>({data:{property_id:'property'}}),maybeSingle:async()=>({data:table==='tour_bookings'?{id:tourId,property_id:'property',lead_id:'lead',status:'confirmed'}:null})};return q})
 d.rpc.mockResolvedValue({data:{state:'applied',tour:{id:tourId,status:'confirmed',schedule_version:2},leadStatus:'tour_booked',changeId:'change',queued:2},error:null})
})
it('authenticates before schedule mutation',async()=>{d.auth.mockResolvedValue({data:{user:null}});expect((await call()).status).toBe(401);expect(d.rpc).not.toHaveBeenCalled()})
it('checks property access before mutation',async()=>{d.access.mockResolvedValue({authorized:false});expect((await call()).status).toBe(403);expect(d.rpc).not.toHaveBeenCalled()})
it('derives the operator and source from trusted context',async()=>{
 const response=await call({...body,actorId:'attacker',source:'tours'});expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store')
 expect(d.rpc).toHaveBeenCalledWith('apply_recorded_tour_action',expect.objectContaining({p_actor_id:'operator',p_source:'tour_bookings',p_request_id:requestId,p_action:'tour.rescheduled',p_input:{expectedVersion:1,action:'reschedule',date:'2099-01-01',time:'10:00',reason:'Prospect requested',notify:true}}))
})
it.each([{...body,reason:' '},{...body,requestId:undefined},{...body,expectedVersion:0},{...body,time:'25:00'},{...body,date:'2099-02-30'},{...body,action:'cancel',date:'2099-01-01'},{...body,action:'reschedule',date:undefined}])('rejects invalid schedule input before mutation',async invalid=>{expect((await call(invalid)).status).toBe(400);expect(d.rpc).not.toHaveBeenCalled()})
it.each(['stale','delivery_busy','delivery_review_required','unavailable','ambiguous_time','needs_timezone','conflict'])('returns a recoverable conflict for %s',async state=>{d.rpc.mockResolvedValue({data:{state}});const response=await call();expect(response.status).toBe(409);expect((await response.json()).code).toBe(state)})
it('reports storage failure as unconfirmed',async()=>{d.rpc.mockResolvedValue({error:{message:'failed'},data:null});expect((await call()).status).toBe(500)})
it('preserves replayed current status',async()=>{d.rpc.mockResolvedValue({data:{state:'replayed',changeId:'change',tour:{id:tourId,status:'cancelled'},leadStatus:'leased'}});expect(await (await call()).json()).toMatchObject({state:'replayed',tour:{status:'cancelled'},leadStatus:'leased'})})
it('rejects unsafe old cancellation requests',async()=>{expect((await DELETE(new NextRequest(`http://localhost/api/leads/lead/tours?tourId=${tourId}`,{method:'DELETE'}),{params:Promise.resolve({id:'lead'})})).status).toBe(400);expect(d.rpc).not.toHaveBeenCalled()})
