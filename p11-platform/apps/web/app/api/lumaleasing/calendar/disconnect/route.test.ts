import {beforeEach,expect,it,vi} from 'vitest'
import type {NextRequest} from 'next/server'
const d=vi.hoisted(()=>({user:vi.fn(),access:vi.fn(),rpc:vi.fn(),admin:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:d.user}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:d.admin}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:d.access}))
import {POST} from './route'
const body={propertyId:'33333333-3333-3333-3333-333333333333',requestId:'13f352ad-9d6b-473a-bf64-68724c0ff3f3',provider:'google'}
const call=(value:unknown=body)=>POST(new Request('http://localhost/api/lumaleasing/calendar/disconnect',{method:'POST',body:JSON.stringify(value)}) as NextRequest)
beforeEach(()=>{vi.resetAllMocks();d.user.mockResolvedValue({data:{user:{id:'verified-actor'}}});d.access.mockResolvedValue({authorized:true});d.admin.mockReturnValue({rpc:d.rpc});d.rpc.mockResolvedValue({data:{state:'applied',disconnected:1,actionEventId:body.requestId}})})
it('requires authentication',async()=>{d.user.mockResolvedValue({data:{user:null}});expect((await call()).status).toBe(401);expect(d.rpc).not.toHaveBeenCalled()})
it('checks membership before privileged access',async()=>{d.access.mockResolvedValue({authorized:false});expect((await call()).status).toBe(403);expect(d.admin).not.toHaveBeenCalled()})
it('uses verified actor and stable request identity',async()=>{const r=await call();expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(d.rpc).toHaveBeenCalledWith('disconnect_recorded_calendar',{p_property_id:body.propertyId,p_request_id:body.requestId,p_provider:'google',p_actor_id:'verified-actor'})})
it.each([{...body,provider:'invalid'},{propertyId:body.propertyId},{...body,actorId:'spoofed'}])('rejects invalid or browser-trusted fields %j',async b=>{expect((await call(b)).status).toBe(400);expect(d.rpc).not.toHaveBeenCalled()})
it.each([null,{state:'applied',disconnected:1},{state:'unknown',disconnected:1,actionEventId:'x'}])('holds unconfirmed persistence %j',async data=>{d.rpc.mockResolvedValue({data});expect((await call()).status).toBe(503)})
it('recovers an already saved decision',async()=>{d.rpc.mockResolvedValue({data:{state:'replayed',disconnected:1,actionEventId:body.requestId}});expect((await call()).status).toBe(200)})
it('returns request conflicts without pretending to disconnect',async()=>{d.rpc.mockResolvedValue({data:{state:'request_conflict'}});expect((await call()).status).toBe(409)})
