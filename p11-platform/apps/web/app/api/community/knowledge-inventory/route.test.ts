import {beforeEach,expect,it,vi} from 'vitest'
const d=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:d.auth}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:d.rpc})}))
import {GET} from './route'
const property='33333333-3333-3333-3333-333333333333',hash='a'.repeat(64)
const get=(suffix='')=>GET(new Request(`http://local/api/community/knowledge-inventory?propertyId=${property}${suffix}`))
beforeEach(()=>{vi.resetAllMocks();d.auth.mockResolvedValue({data:{user:{id:'current-actor'}},error:null});d.rpc.mockResolvedValue({data:{state:'ready',propertyId:property,kind:'sources',items:[],summary:{sourceCount:0},inventoryHash:hash},error:null})})
it('requires a current authenticated actor before any read',async()=>{d.auth.mockResolvedValue({data:{user:null},error:null});expect((await get()).status).toBe(401);expect(d.rpc).not.toHaveBeenCalled()})
it('passes exact scope and complete page criteria without trusting a supplied actor',async()=>{const r=await get(`&offset=1020&expectedHash=${hash}`);expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store');expect(d.rpc).toHaveBeenCalledWith('read_property_knowledge',{p_property_id:property,p_actor_id:'current-actor',p_input:{kind:'sources',offset:1020,expectedHash:hash}});d.rpc.mockClear();expect((await get('&actorId=forged')).status).toBe(400);expect(d.rpc).not.toHaveBeenCalled()})
it('rejects invalid group, offset and unrelated parameters',async()=>{for(const q of['&kind=chunks','&offset=-1','&offset=1.5','&expectedHash=bad','&groupKey='+hash,'&kind=chunks&groupKey=bad'])expect((await get(q)).status).toBe(400);expect(d.rpc).not.toHaveBeenCalled()})
it('keeps permission, changed inventory and missing group outcomes distinct from empty data',async()=>{for(const[state,status]of[['forbidden',403],['inventory_changed',409],['not_found',404]]as const){d.rpc.mockResolvedValueOnce({data:{state},error:null});const r=await get();expect(r.status).toBe(status);expect(await r.json()).not.toHaveProperty('items')}})
it('does not leak database errors or accept a wrong-property response',async()=>{d.rpc.mockResolvedValueOnce({data:null,error:{message:'Secret database internals'}});let r=await get();expect(r.status).toBe(503);expect(await r.text()).not.toContain('Secret');d.rpc.mockResolvedValueOnce({data:{state:'ready',propertyId:'other',items:[]},error:null});r=await get();expect(r.status).toBe(503)})
