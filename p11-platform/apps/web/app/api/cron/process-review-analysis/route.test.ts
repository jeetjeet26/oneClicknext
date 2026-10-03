import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const {rpc,start,finish,run}=vi.hoisted(()=>({rpc:vi.fn(),start:vi.fn(),finish:vi.fn(),run:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc})}))
vi.mock('@/utils/services/cron-job-runs',()=>({startCronJobRun:start,finishCronJobRun:finish}))
vi.mock('@/utils/reviewflow/batch-store',()=>({runReviewAnalysisBatch:run}))
import {GET} from './route'
const req=(token='fixture-secret')=>new NextRequest('http://localhost/api/cron/process-review-analysis',{headers:{authorization:`Bearer ${token}`}})
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('CRON_SECRET','fixture-secret');vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','false');start.mockResolvedValue({id:'cron-run'});finish.mockResolvedValue(undefined);rpc.mockResolvedValue({data:['saved-batch'],error:null});run.mockResolvedValue({state:'running'})})
afterEach(()=>vi.unstubAllEnvs())
describe('approved analysis queue scheduler',()=>{
 it('requires configured authorization before all database work',async()=>{expect((await GET(req('wrong'))).status).toBe(401);vi.stubEnv('CRON_SECRET','');expect((await GET(req())).status).toBe(401);expect(start).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled()})
 it('does not claim queued models while external work is paused',async()=>{vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','true');expect(await (await GET(req())).json()).toEqual({state:'paused',processed:0});expect(run).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled()})
 it('continues only eligible saved queues without inventing completed results',async()=>{expect(await (await GET(req())).json()).toMatchObject({status:'success',processed:1,completed:0,needsReview:0});expect(rpc).toHaveBeenCalledWith('list_reviewflow_batch_work',{p_limit:5});expect(run).toHaveBeenCalledWith('saved-batch')})
 it('distinguishes confirmed completion from partial and unconfirmed work',async()=>{rpc.mockResolvedValue({data:['done','held','unknown'],error:null});run.mockResolvedValueOnce({state:'completed'}).mockResolvedValueOnce({state:'needs_review'}).mockRejectedValueOnce(new Error('private detail'));const response=await GET(req()),body=await response.json();expect(body).toMatchObject({status:'partial',processed:3,completed:1,needsReview:2});expect(JSON.stringify(body)).not.toContain('private');expect(finish).toHaveBeenCalledWith({id:'cron-run'},expect.objectContaining({status:'partial'}))})
 it('reports storage failures and never silently drops the queue',async()=>{rpc.mockResolvedValue({data:null,error:{message:'private database error'}});const response=await GET(req());expect(response.status).toBe(503);expect(await response.text()).not.toContain('private');expect(run).not.toHaveBeenCalled()})
})
