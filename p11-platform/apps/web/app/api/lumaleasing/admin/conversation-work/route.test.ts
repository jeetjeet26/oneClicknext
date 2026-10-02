import {beforeEach,it,expect,vi} from 'vitest'
const calls=vi.hoisted(()=>({actor:vi.fn(),rpc:vi.fn()}))
vi.mock('@/utils/lumaleasing/conversation-store',async()=>({conversationActor:calls.actor,conversationRpc:calls.rpc,InventoryError:(await import('@/utils/knowledge/inventory')).InventoryError}))
import {GET,POST} from './route'
const id='12345678-1234-1234-1234-123456789012',url='http://localhost:9430/api/lumaleasing/admin/conversation-work',base={id,propertyId:id,expectedActorId:id,operation:'reply',conversationId:id,sourceHash:'a'.repeat(64),content:'Actual message'}
const req=(input:unknown=base,origin='http://localhost:9430')=>new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(input)})
beforeEach(()=>{vi.clearAllMocks();calls.actor.mockResolvedValue(id);calls.rpc.mockResolvedValue({state:'saved',propertyId:id,id})})
it('uses authenticated current actor and exact conversation source',async()=>{expect((await POST(req())).status).toBe(200);expect(calls.rpc).toHaveBeenCalledWith('decide_luma_conversation',{p_id:id,p_actor_id:id,p_property_id:id,p_input:{operation:'reply',conversationId:id,sourceHash:'a'.repeat(64),content:'Actual message'}})})
it('rejects another origin before a write',async()=>{expect((await POST(req(base,'https://other.invalid'))).status).toBe(403);expect(calls.rpc).not.toHaveBeenCalled()})
it('rejects changed sign-in identity',async()=>{calls.actor.mockResolvedValue('another');expect((await POST(req())).status).toBe(409);expect(calls.rpc).not.toHaveBeenCalled()})
it('does not accept a client author or transcript',async()=>{expect((await POST(req({...base,actorId:'forged'}))).status).toBe(400);expect(calls.rpc).not.toHaveBeenCalled()})
it('returns private uncached history with explicit page identity',async()=>{const r=await GET(new Request(url+'?propertyId='+id+'&kind=history&offset=25'));expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');expect(calls.rpc).toHaveBeenCalledWith('read_luma_conversations',expect.objectContaining({p_actor_id:id,p_offset:25,p_kind:'history'}))})
it('rejects malformed private page requests',async()=>{expect((await GET(new Request(url+'?propertyId='+id+'&offset=-1'))).status).toBe(400);expect(calls.rpc).not.toHaveBeenCalled()})
it('hides unexpected storage details',async()=>{calls.rpc.mockRejectedValue(new Error('Private visitor original'));const r=await POST(req());expect(r.status).toBe(503);expect(JSON.stringify(await r.json())).not.toContain('Private visitor original')})
