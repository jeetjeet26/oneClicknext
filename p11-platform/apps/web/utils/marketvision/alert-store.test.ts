import {beforeEach,describe,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:mocks.rpc})}))
import {alertRpc,readMarketAlerts} from './alert-store'
describe('complete alert reads and decisions',()=>{
 beforeEach(()=>vi.clearAllMocks())
 it.each(['forbidden','not_found','stale_alert','alert_state_changed','request_conflict','cursor_changed'])('surfaces %s without partial success',async state=>{mocks.rpc.mockResolvedValue({data:{state},error:null});await expect(alertRpc('review',{})).rejects.toThrow()})
 it('does not replace a failed count/read with an empty result',async()=>{mocks.rpc.mockResolvedValue({data:null,error:{message:'private'}});await expect(readMarketAlerts({})).rejects.toThrow('could not be confirmed');mocks.rpc.mockResolvedValue({data:{state:'ready',alerts:[]},error:null});await expect(readMarketAlerts({})).rejects.toThrow('complete alert list')})
 it('accepts complete counts larger than a page',async()=>{mocks.rpc.mockResolvedValue({data:{state:'ready',alerts:[],nextCursor:null,counts:{all:1005,open:1003,unread:990,dismissed:2},readAt:'2026-09-22'},error:null});expect((await readMarketAlerts({p_property_id:'property'})).counts.all).toBe(1005)})
})
