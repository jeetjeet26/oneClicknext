import {beforeEach,expect,it,vi} from 'vitest'
import type {NextRequest} from 'next/server'
const d=vi.hoisted(()=>({user:vi.fn(),access:vi.fn(),bind:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:d.user}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:d.access}))
vi.mock('@/utils/services/tour-calendar-binding',async original=>({...await original<typeof import('@/utils/services/tour-calendar-binding')>(),bindCalendarEvent:d.bind}))
import {POST} from './route'
const input={action:'list',propertyId:'33333333-3333-3333-3333-333333333333',bookingId:'88888888-8888-4888-8888-888888888888',version:1}
const send=(body:unknown=input)=>POST(new Request('http://localhost/api/lumaleasing/tours/calendar-binding',{method:'POST',body:JSON.stringify(body)}) as NextRequest)
beforeEach(()=>{vi.resetAllMocks();d.user.mockResolvedValue({data:{user:{id:'actor'}}});d.access.mockResolvedValue({authorized:true});d.bind.mockResolvedValue({state:'listed',events:[]})})
it('requires authentication before querying calendar providers',async()=>{d.user.mockResolvedValue({data:{user:null}});expect((await send()).status).toBe(401);expect(d.bind).not.toHaveBeenCalled()})
it('requires access to the requested property',async()=>{d.access.mockResolvedValue({authorized:false});expect((await send()).status).toBe(403);expect(d.bind).not.toHaveBeenCalled()})
it('does not accept browser provider evidence',async()=>{expect((await send({...input,remote:{id:'spoof'}})).status).toBe(400);expect(d.bind).not.toHaveBeenCalled()})
it('uses the authenticated actor and prevents status caching',async()=>{const r=await send();expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('no-store');expect(d.bind).toHaveBeenCalledWith({},'actor',input)})
it('returns actionable conflict instead of a success response',async()=>{d.bind.mockResolvedValue({state:'binding_conflict'});const r=await send();expect(r.status).toBe(409);expect((await r.json()).error).toContain('already has a calendar link')})
it('holds a provider outage without exposing raw errors',async()=>{d.bind.mockRejectedValue(new Error('PRIVATE PROVIDER DETAILS'));const r=await send();expect(r.status).toBe(503);expect(JSON.stringify(await r.json())).not.toContain('PRIVATE')})
