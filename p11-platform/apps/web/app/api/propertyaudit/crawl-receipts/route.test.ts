import {describe,it,expect,vi,beforeEach} from 'vitest'
const mocks=vi.hoisted(()=>({actor:vi.fn(),rpc:vi.fn()}))
vi.mock('@/utils/propertyaudit/decision-store',async()=>{const actual=await vi.importActual<typeof import('@/utils/propertyaudit/decision-store')>('@/utils/propertyaudit/decision-store');return {...actual,auditActor:mocks.actor,auditRpc:mocks.rpc}})
import {GET} from './route'
import {InventoryError} from '@/utils/propertyaudit/decision-store'
const id='aa800000-0000-4000-8000-000000000001',propertyId='aa800000-0000-4000-8000-000000000002',actor='aa800000-0000-4000-8000-000000000003'
const request=(extra='')=>new Request(`http://localhost/api/propertyaudit/crawl-receipts?propertyId=${propertyId}&crawlId=${id}${extra}`)
beforeEach(()=>{vi.clearAllMocks();mocks.actor.mockResolvedValue(actor);mocks.rpc.mockResolvedValue({state:'ready',propertyId,id,items:[],count:55})})
describe('private retained crawl evidence',()=>{
 it('uses current authenticated membership and exact crawl scope',async()=>{const response=await GET(request());expect(response.status).toBe(200);expect(mocks.actor).toHaveBeenCalledWith(propertyId);expect(mocks.rpc).toHaveBeenCalledWith('read_geo_crawl_receipts',{p_actor_id:actor,p_property_id:propertyId,p_crawl_id:id,p_id:null,p_offset:0,p_hash:null});expect(await response.json()).toMatchObject({actorId:actor,crawlId:id,count:55})})
 it('continues complete versioned history and reads exact private receipts',async()=>{await GET(request('&offset=50&hash='+ 'a'.repeat(64)+'&id='+id));expect(mocks.rpc).toHaveBeenCalledWith('read_geo_crawl_receipts',expect.objectContaining({p_offset:50,p_hash:'a'.repeat(64),p_id:id}))})
 it.each(['&offset=-1','&offset=0.5','&hash=bad','&id=wrong','&p_token=secret','&actorId='+actor])('rejects malformed or injected selectors %s',async extra=>{expect((await GET(request(extra))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('denies lost membership before reading private output',async()=>{mocks.actor.mockRejectedValue(new InventoryError('Access removed',403));expect((await GET(request())).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('reports changed history as a refreshable conflict',async()=>{mocks.rpc.mockRejectedValue(new InventoryError('History changed',409));expect((await GET(request('&offset=25'))).status).toBe(409)})
 it('hides internal failures and disables response caching',async()=>{mocks.rpc.mockRejectedValue(new Error('private database detail'));const result=await GET(request());expect(result.status).toBe(503);expect(JSON.stringify(await result.json())).not.toContain('private database detail');expect(result.headers.get('Cache-Control')).toContain('no-store')})
})
