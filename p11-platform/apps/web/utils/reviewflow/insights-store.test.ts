import {beforeEach,describe,expect,it,vi} from 'vitest'
const {rpc,from}=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn()}))
vi.mock('./analysis-store',async()=>({...await vi.importActual('./analysis-store'),reviewRpc:rpc}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from})}))
import {readInsightPreview,saveInsightReport} from './insights-store'
const source={asOf:'2026-09-18T00:00:00.000Z',windowDays:90,reviews:[],analyses:[],cases:[],coverage:{dateFallbackReviews:0,staffReviewAnalyses:0,openPropertyCases:0,storedPropertyReviews:0}},input={windowDays:90,asOf:source.asOf,sourceHash:'a'.repeat(64),reason:'Reviewed source coverage'}
function chain(data:unknown,error:unknown=null){const q={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({data,error})};q.select.mockReturnValue(q);q.eq.mockReturnValue(q);return q}
beforeEach(()=>{vi.clearAllMocks();from.mockReturnValue(chain(null));rpc.mockImplementation(async(name:string)=>name==='read_reviewflow_insight_source'?{state:'ready',source,sourceHash:input.sourceHash}:{state:'saved',reportId:'report'})})
describe('exact saved insights',()=>{
 it('computes a report from one database source snapshot without losing coverage',async()=>{expect(await readInsightPreview('property','actor',90,source.asOf)).toMatchObject({insightsVersion:'reviewflow-insights-v2',sourceHash:input.sourceHash,coverage:source.coverage,totalReviews:0});expect(rpc).toHaveBeenCalledExactlyOnceWith('read_reviewflow_insight_source',expect.objectContaining({p_as_of:source.asOf}),['ready'])})
 it('saves server-computed results only for the exact preview hash',async()=>{await saveInsightReport('report','property','actor',input);expect(rpc).toHaveBeenCalledWith('save_reviewflow_insight_report',expect.objectContaining({p_input:input,p_result:expect.objectContaining({totalReviews:0,sourceHash:input.sourceHash})}),['saved','replayed'])})
 it('requires a fresh review if a source changed after preview',async()=>{rpc.mockResolvedValue({state:'ready',source,sourceHash:'different'});await expect(saveInsightReport('report','property','actor',input)).rejects.toMatchObject({status:409});expect(rpc).toHaveBeenCalledTimes(1)})
 it('recovers a lost saved reply without rebuilding current data',async()=>{from.mockReturnValue(chain({id:'report'}));await saveInsightReport('report','property','actor',input);expect(rpc).toHaveBeenCalledExactlyOnceWith('save_reviewflow_insight_report',expect.objectContaining({p_result:{},p_input:input}),['saved','replayed'])})
 it('does not treat unavailable history as a missing report',async()=>{from.mockReturnValue(chain(null,{message:'private failure'}));await expect(saveInsightReport('report','property','actor',input)).rejects.toThrow('could not be loaded');expect(rpc).not.toHaveBeenCalled()})
})
