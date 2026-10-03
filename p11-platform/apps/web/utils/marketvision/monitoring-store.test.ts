import {beforeEach,describe,it,expect,vi} from 'vitest'
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc})}))
import {readMarketMonitoring} from './monitoring-store'
import {marketRunStatus} from './monitoring-contract'
const id='11111111-1111-1111-1111-111111111111',args={propertyId:id,actorId:id,filter:'all'},row={id,created_at:'2026-09-22',updated_at:'2026-09-22',kind:'source' as const,request_state:'received',category:'attention' as const,label:'Saved source',competitor_id:id,brief_id:null,handoff_id:null,legacy_status:null},page={state:'ready',runs:[row],nextCursor:null,counts:{all:1005,attention:1,active:0,complete:0,closed:0,legacy:1004},workers:['process-market-sources','process-market-extractions'].map(name=>({name,lastStartedAt:null,lastFinishedAt:null,lastStatus:null})),readAt:'2026-09-22'}
describe('complete monitoring receipts',()=>{
 beforeEach(()=>vi.clearAllMocks())
 it('preserves complete counts independently of bounded page size',async()=>{rpc.mockResolvedValue({data:page,error:null});expect(await readMarketMonitoring(args)).toMatchObject({counts:{all:1005},runs:[row]})})
 it('opens a saved identity without requiring it in the first page',async()=>{rpc.mockResolvedValue({data:{state:'ready',run:row},error:null});expect(await readMarketMonitoring({...args,requestId:id})).toMatchObject({run:row})})
 it.each([['forbidden',403],['not_found',404],['cursor_changed',409]])('surfaces %s',async(state,status)=>{rpc.mockResolvedValue({data:{state},error:null});await expect(readMarketMonitoring(args)).rejects.toMatchObject({status})})
 it.each([{data:null,error:null},{data:page,error:{message:'failed'}},{data:{...page,counts:undefined},error:null},{data:{...page,runs:Array(21).fill(row)},error:null},{data:{...page,workers:[]},error:null}])('rejects incomplete or failed evidence',async result=>{rpc.mockResolvedValue(result);await expect(readMarketMonitoring(args)).rejects.toMatchObject({status:503})})
 it('does not equate a captured page, legacy success or draft creation to verified price effects',()=>{expect(marketRunStatus(row)).toBe('Captured page needs review');expect(marketRunStatus({...row,kind:'legacy',legacy_status:'succeeded'})).toBe('Historical record · succeeded');expect(marketRunStatus({...row,kind:'handoff',request_state:'completed'})).toBe('Draft created');expect(marketRunStatus({...row,kind:'extraction',request_state:'completed'})).toBe('Reviewed prices applied')})
})
