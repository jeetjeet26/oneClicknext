import {beforeEach,describe,expect,it,vi} from 'vitest'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc})}))
import {readMarketAnalysis} from './analysis-store'
describe('complete analysis reads',()=>{
 beforeEach(()=>vi.clearAllMocks())
 it.each([{error:{message:'unavailable'},data:null},{error:null,data:{state:'ready',units:[]}},{error:null,data:{state:'snapshot_too_large'}}])('rejects failed or partial snapshots',async result=>{rpc.mockResolvedValue(result);await expect(readMarketAnalysis('property','actor',30)).rejects.toMatchObject({status:503})})
 it('enforces fresh database access denial',async()=>{rpc.mockResolvedValue({error:null,data:{state:'forbidden'}});await expect(readMarketAnalysis('property','actor',7)).rejects.toMatchObject({status:403});expect(rpc).toHaveBeenCalledWith('read_marketvision_analysis',{p_property_id:'property',p_actor_id:'actor',p_days:7})})
})
