import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
const mocks=vi.hoisted(()=>({auth:vi.fn(),start:vi.fn(),confirm:vi.fn(),finish:vi.fn(),query:vi.fn(),run:vi.fn(),status:vi.fn()}))
vi.mock('@/utils/services/api-helpers',()=>({validateCronAuth:mocks.auth}))
vi.mock('@/utils/services/cron-job-runs',()=>({startCronJobRun:mocks.start,confirmCronJobRun:mocks.confirm,finishCronJobRun:mocks.finish}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:()=>({select:()=>({eq:()=>({order:()=>({limit:mocks.query})})})})})}))
vi.mock('@/utils/marketvision/source-store',()=>({runSource:mocks.run,sourceExecutionStatus:mocks.status}))
import { GET } from './route'
const req=()=>new NextRequest('http://localhost/api/cron/process-market-sources')
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockReturnValue(null);mocks.status.mockReturnValue({paused:false});mocks.start.mockResolvedValue('run');mocks.query.mockResolvedValue({data:[{id:'source'}],error:null});mocks.run.mockResolvedValue({state:'saved',requestState:'received'});mocks.confirm.mockResolvedValue(undefined)})
describe('source receipt worker',()=>{
 it('requires cron authorization',async()=>{mocks.auth.mockReturnValue(NextResponse.json({error:'Unauthorized'},{status:401}));expect((await GET(req())).status).toBe(401);expect(mocks.start).not.toHaveBeenCalled()})
 it('respects pause before ledger, claim or execution',async()=>{mocks.status.mockReturnValue({paused:true});expect(await(await GET(req())).json()).toEqual({state:'paused',processed:0});expect(mocks.start).not.toHaveBeenCalled();expect(mocks.run).not.toHaveBeenCalled()})
 it('requires a saved worker receipt before any execution',async()=>{mocks.start.mockResolvedValue(null);expect((await GET(req())).status).toBe(503);expect(mocks.run).not.toHaveBeenCalled()})
 it('records actual request outcomes',async()=>{expect((await GET(req())).status).toBe(200);expect(mocks.query).toHaveBeenCalledWith(2);expect(mocks.confirm).toHaveBeenCalledWith('run',{status:'success',summary:{processed:1,outcomes:[{requestId:'source',state:'received'}]}})})
 it('reports held and unconfirmed fetches as failure',async()=>{mocks.run.mockResolvedValue({state:'saved',requestState:'held'});expect((await GET(req())).status).toBe(503);expect(mocks.confirm).toHaveBeenCalledWith('run',expect.objectContaining({status:'failed'}))})
 it('failed queue reads never become an empty success',async()=>{mocks.query.mockResolvedValue({data:null,error:{message:'unavailable'}});expect((await GET(req())).status).toBe(503);expect(mocks.run).not.toHaveBeenCalled();expect(mocks.finish).toHaveBeenCalled()})
})
