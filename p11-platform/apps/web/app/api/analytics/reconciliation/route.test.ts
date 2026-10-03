import {beforeEach,describe,it,expect,vi} from 'vitest'
const calls=vi.hoisted(()=>({actor:vi.fn(),rpc:vi.fn()}))
vi.mock('@/utils/analytics/data-review-store',async()=>({dataReviewActor:calls.actor,dataReviewRpc:calls.rpc,InventoryError:(await import('@/utils/knowledge/inventory')).InventoryError}))
import {GET,POST} from './route'
const id='12345678-1234-1234-1234-123456789012',other='22345678-1234-1234-1234-123456789012',url='http://localhost:9430/api/analytics/reconciliation',base={id,propertyId:id,expectedActorId:id,operation:'cancel'}
const req=(input:unknown=base,origin='http://localhost:9430')=>new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(input)})
beforeEach(()=>{vi.clearAllMocks();calls.actor.mockResolvedValue(id);calls.rpc.mockResolvedValue({state:'saved',propertyId:id,id,status:'cancelled'})})
describe('private data review route',()=>{
 it('passes server-authenticated actor and exact decision',async()=>{expect((await POST(req())).status).toBe(200);expect(calls.rpc).toHaveBeenCalledWith('decide_bi_data_review',{p_id:id,p_actor_id:id,p_property_id:id,p_input:{operation:'cancel'}})})
 it('rejects another origin before native mutation',async()=>{expect((await POST(req(base,'https://other.invalid'))).status).toBe(403);expect(calls.rpc).not.toHaveBeenCalled()})
 it('rejects changed signed-in identity',async()=>{calls.actor.mockResolvedValue(other);expect((await POST(req())).status).toBe(409);expect(calls.rpc).not.toHaveBeenCalled()})
 it('rejects source contents in a decision',async()=>{expect((await POST(req({...base,source:{rows:[]}}))).status).toBe(400);expect(calls.rpc).not.toHaveBeenCalled()})
 it('returns private uncached retained reads',async()=>{const response=await GET(new Request(url+'?propertyId='+id+'&kind=history&offset=25'));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');expect(calls.rpc).toHaveBeenCalledWith('read_bi_data_review',expect.objectContaining({p_actor_id:id,p_kind:'history',p_offset:25}))})
 it('rejects malformed page queries',async()=>{expect((await GET(new Request(url+'?propertyId='+id+'&offset=-1'))).status).toBe(400);expect(calls.rpc).not.toHaveBeenCalled()})
 it('leaves unexpected failures unconfirmed and hides internals',async()=>{calls.rpc.mockRejectedValue(new Error('private database secret'));const r=await POST(req());expect(r.status).toBe(503);expect(JSON.stringify(await r.json())).not.toContain('private database secret')})
})
