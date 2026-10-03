import {beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const d=vi.hoisted(()=>({auth:vi.fn(),access:vi.fn(),rpc:vi.fn(),rows:vi.fn(),eq:vi.fn(),or:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:d.auth}})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:d.access}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:d.rpc,from:()=>{const q={select:()=>q,eq:(...args:unknown[])=>{d.eq(...args);return q},or:(...args:unknown[])=>{d.or(...args);return q},order:()=>q,limit:d.rows};return q}})}))
import {GET,POST} from './route'
const actor='11111111-1111-4111-8111-111111111111',property='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333'
const input={id,episodeId:id,propertyId:property,expectedActorId:actor,path:'/dashboard/leads'}
const post=(body:unknown=input)=>POST(new NextRequest('http://localhost/api/activity',{method:'POST',body:JSON.stringify(body)}))
const get=(query=`propertyId=${property}`)=>GET(new NextRequest(`http://localhost/api/activity?${query}`))
beforeEach(()=>{vi.resetAllMocks();d.auth.mockResolvedValue({data:{user:{id:actor}},error:null});d.access.mockResolvedValue({authorized:true,orgId:'org'});d.rpc.mockResolvedValue({data:{state:'recorded',eventId:id}});d.rows.mockResolvedValue({data:[]})})
it('requires a session for observations and history',async()=>{d.auth.mockResolvedValue({data:{user:null}});expect((await post()).status).toBe(401);expect((await get()).status).toBe(401);expect(d.rpc).not.toHaveBeenCalled()})
it('requires property access for reads and writes',async()=>{d.access.mockResolvedValue({authorized:false});expect((await post()).status).toBe(403);expect((await get()).status).toBe(403);expect(d.rpc).not.toHaveBeenCalled();expect(d.rows).not.toHaveBeenCalled()})
it('rejects stale observations from a different signed-in user',async()=>{expect((await post({...input,expectedActorId:property})).status).toBe(409);expect(d.rpc).not.toHaveBeenCalled()})
it('derives product and low-trust observation from registered path',async()=>{expect((await post()).status).toBe(200);expect(d.rpc).toHaveBeenCalledWith('append_shared_action_event',expect.objectContaining({p_actor_id:actor,p_property_id:property,p_product:'tourspark',p_evidence:'browser_observed',p_phase:'observed',p_request:{path:'/dashboard/leads'}}))})
it.each([{action:'workflow.pause'},{phase:'succeeded'},{token:'secret'},{before:{status:'active'}}])('rejects untrusted extra fields %o',async extra=>{expect((await post({...input,...extra})).status).toBe(400);expect(d.rpc).not.toHaveBeenCalled()})
it.each(['/dashboard/leads?email=private','/dashboard/leads/secret-resource','/unknown','/dashboard/unregistered'])('does not retain arbitrary URL payload %s',async path=>{expect((await post({...input,path})).status).toBe(400)})
it('does not claim success after a lost persistence acknowledgement',async()=>{d.rpc.mockResolvedValue({error:{message:'offline'}});expect((await post()).status).toBe(503)})
it('accepts a persisted same-ID replay',async()=>{d.rpc.mockResolvedValue({data:{state:'replayed',eventId:id}});expect((await post()).status).toBe(200)})
it('surfaces conflicting observation identity',async()=>{d.rpc.mockResolvedValue({data:{state:'request_conflict'}});expect((await post()).status).toBe(409)})
it('scopes history to property and hides actor IDs',async()=>{d.rows.mockResolvedValue({data:[{id,actor_id:actor,created_at:'2026-09-16T00:00:00Z'}]});const response=await get();const body=await response.json();expect(response.status).toBe(200);expect(d.eq).toHaveBeenCalledWith('property_id',property);expect(body.events[0].actor).toBe('You');expect(body.events[0].actor_id).toBeUndefined();expect(body.coverage).toContain('may be incomplete')})
it('requires valid paired cursor fields and known products',async()=>{expect((await get(`propertyId=${property}&beforeId=${id}`)).status).toBe(400);expect((await get(`propertyId=${property}&product=made-up`)).status).toBe(400)})
it('uses a stable timestamp and ID boundary for pagination',async()=>{const at='2026-09-16T00:00:00Z';expect((await get(`propertyId=${property}&before=${at}&beforeId=${id}`)).status).toBe(200);expect(d.or).toHaveBeenCalledWith(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${id})`)})
it('never disguises database failure as an empty history',async()=>{d.rows.mockResolvedValue({error:{message:'offline'}});expect((await get()).status).toBe(500)})

it('accepts canonical IDs used by the existing local seed schema',async()=>{
 const legacyActor='11111111-1111-1111-1111-111111111111',legacyProperty='22222222-2222-2222-2222-222222222222'
 d.auth.mockResolvedValue({data:{user:{id:legacyActor}}})
 expect((await post({...input,expectedActorId:legacyActor,propertyId:legacyProperty})).status).toBe(200)
 expect((await get(`propertyId=${legacyProperty}`)).status).toBe(200)
})
it('returns the exact next-page boundary including database timezone offsets',async()=>{
 const at='2026-09-16T00:00:00+00:00';d.rows.mockResolvedValue({data:Array.from({length:51},(_,index)=>({id:index===49?id:`row-${index}`,actor_id:actor,created_at:at}))})
 const result=await (await get()).json();expect(result.events).toHaveLength(50);expect(result.nextCursor).toEqual({before:at,beforeId:id})
 expect((await get(new URLSearchParams({propertyId:property,...result.nextCursor}).toString())).status).toBe(200)
})

it('exposes only the integration failure reason, not arbitrary result payloads',async()=>{
 d.rows.mockResolvedValue({data:[{id,actor_id:actor,action:'integration.authorization.failed',product:'integrations',phase:'failed',request:{},result:{state:'permissions_incomplete',detail:'private-result'},created_at:'2026-09-16T00:00:00Z'},{id:property,actor_id:actor,action:'workflow.pause',product:'tourspark',phase:'succeeded',request:{},result:{detail:'private-result'},created_at:'2026-09-16T00:00:00Z'}]})
 const result=await (await get()).json();expect(result.events[0].result).toEqual({state:'permissions_incomplete'});expect(result.events[1].result).toBeUndefined();expect(JSON.stringify(result)).not.toContain('private-result')
})
