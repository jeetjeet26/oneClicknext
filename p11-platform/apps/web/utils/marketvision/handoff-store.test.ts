import {beforeEach,describe,it,expect,vi} from 'vitest'
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc})}))
import {handoffRpc} from './handoff-store'
describe('handoff saved results',()=>{
 beforeEach(()=>vi.clearAllMocks())
 it.each(['ready','saved','replayed'])('accepts only confirmed %s',async state=>{rpc.mockResolvedValue({data:{state},error:null});expect(await handoffRpc('read_marketvision_handoffs',{})).toEqual({state})})
 it.each([['forbidden',403],['manager_required',403],['not_found',404],['stale_handoff',409],['stale_review',409],['source_changed',409],['request_conflict',409],['handoff_exists',409],['source_review_required',409]])('surfaces %s for review',async(state,status)=>{rpc.mockResolvedValue({data:{state},error:null});await expect(handoffRpc('decide_marketvision_handoff',{})).rejects.toMatchObject({status})})
 it.each([{data:null,error:null},{data:{state:'saved'},error:{code:'rpc_error'}}])('never confirms missing or failed writes',async result=>{rpc.mockResolvedValue(result);await expect(handoffRpc('decide_marketvision_handoff',{})).rejects.toMatchObject({status:503})})
})
