import {beforeEach,it,expect,vi} from 'vitest'
const calls=vi.hoisted(()=>({actor:vi.fn(),rpc:vi.fn()}))
vi.mock('@/utils/lumaleasing/widget-operation-store',async()=>({widgetActor:calls.actor,widgetRpc:calls.rpc,InventoryError:(await import('@/utils/knowledge/inventory')).InventoryError}))
import {GET,POST} from './route'
const id='12345678-1234-1234-1234-123456789012',url='http://localhost:9430/api/lumaleasing/admin/operations',base={id,propertyId:id,expectedActorId:id,operation:'prepare',kind:'embed',keyVersion:'a'.repeat(64)}
const req=(input:unknown=base,origin='http://localhost:9430')=>new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(input)})
beforeEach(()=>{vi.clearAllMocks();calls.actor.mockResolvedValue(id);calls.rpc.mockResolvedValue({state:'saved',propertyId:id,id})})
it('uses authenticated actor and actual console origin for installation preparation',async()=>{expect((await POST(req())).status).toBe(200);expect(calls.rpc).toHaveBeenCalledWith('decide_luma_widget_operation',{p_id:id,p_actor_id:id,p_property_id:id,p_input:{operation:'prepare',kind:'embed',keyVersion:'a'.repeat(64),origin:'http://localhost:9430'}})})
it('rejects another origin before a mutation',async()=>{expect((await POST(req(base,'https://other.invalid'))).status).toBe(403);expect(calls.rpc).not.toHaveBeenCalled()})
it('rejects changed sign-in identity',async()=>{calls.actor.mockResolvedValue('another');expect((await POST(req())).status).toBe(409);expect(calls.rpc).not.toHaveBeenCalled()})
it('does not accept a client-provided installation host',async()=>{expect((await POST(req({...base,origin:'https://forged.invalid'}))).status).toBe(400);expect(calls.rpc).not.toHaveBeenCalled()})
it('returns private uncached history',async()=>{const r=await GET(new Request(url+'?propertyId='+id+'&offset=25'));expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');expect(calls.rpc).toHaveBeenCalledWith('read_luma_widget_operations',expect.objectContaining({p_actor_id:id,p_offset:25}))})
it('rejects invalid private history requests',async()=>{expect((await GET(new Request(url+'?propertyId='+id+'&offset=-1'))).status).toBe(400);expect(calls.rpc).not.toHaveBeenCalled()})
it('never exposes unexpected storage errors',async()=>{calls.rpc.mockRejectedValue(new Error('private original key'));const r=await POST(req());expect(r.status).toBe(503);expect(JSON.stringify(await r.json())).not.toContain('private original key')})
