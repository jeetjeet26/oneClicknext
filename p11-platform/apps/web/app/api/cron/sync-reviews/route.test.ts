import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const {rpc,start,finish,requestIntake,run}=vi.hoisted(()=>({rpc:vi.fn(),start:vi.fn(),finish:vi.fn(),requestIntake:vi.fn(),run:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc})}))
vi.mock('@/utils/services/cron-job-runs',()=>({startCronJobRun:start,finishCronJobRun:finish}))
vi.mock('@/utils/reviewflow/intake-store',()=>({requestIntake,runSavedIntake:run}))
import {GET} from './route'
function req(token='fixture-secret'){return new NextRequest('http://localhost/api/cron/sync-reviews',{headers:{authorization:`Bearer ${token}`}})}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('CRON_SECRET','fixture-secret');vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','false');start.mockResolvedValue({id:'cron-run'});finish.mockResolvedValue(true);rpc.mockResolvedValue({data:[{id:'source',property_id:'property',version:4,schedule_key:'source:4:2026-09-18-12'}],error:null});requestIntake.mockResolvedValue({state:'queued',requestId:'saved-request'});run.mockResolvedValue({state:'preview'})})
afterEach(()=>vi.unstubAllEnvs())
describe('recorded source check scheduler',()=>{
 it('requires configured cron authorization before database work',async()=>{expect((await GET(req('wrong'))).status).toBe(401);vi.stubEnv('CRON_SECRET','');expect((await GET(req())).status).toBe(401);expect(rpc).not.toHaveBeenCalled();expect(start).not.toHaveBeenCalled()})
 it('respects external pause without claiming success',async()=>{vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','true');expect(await (await GET(req())).json()).toEqual({state:'paused',fetched:0,applied:0});expect(rpc).not.toHaveBeenCalled();expect(run).not.toHaveBeenCalled()})
 it('uses saved system intent and reports previews separately from applied reviews',async()=>{expect(await (await GET(req())).json()).toMatchObject({status:'success',previewReady:1,applied:0});expect(requestIntake).toHaveBeenCalledWith(expect.any(String),'property',null,expect.objectContaining({trigger:'schedule',connectionVersion:4,scheduleKey:'source:4:2026-09-18-12'}));expect(requestIntake.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]);expect(run).toHaveBeenCalledWith('saved-request')})
 it('does not invoke an already running fetch again',async()=>{requestIntake.mockResolvedValue({state:'running',requestId:'saved-request'});await GET(req());expect(run).not.toHaveBeenCalled()})
 it('records held and failed source results without reporting a successful sync',async()=>{run.mockResolvedValue({state:'held'});expect(await (await GET(req())).json()).toMatchObject({status:'failed',failed:1,applied:0});expect(finish).toHaveBeenCalledWith({id:'cron-run'},expect.objectContaining({status:'failed'}))})
 it('surfaces scheduler storage errors with safe recovery guidance',async()=>{rpc.mockResolvedValue({error:{message:'private connection failure'}});const r=await GET(req());expect(r.status).toBe(503);expect(await r.text()).not.toContain('private connection');expect(run).not.toHaveBeenCalled()})
 it('does not fetch or queue work when its run record cannot be created',async()=>{start.mockResolvedValue(null);expect((await GET(req())).status).toBe(503);expect(rpc).not.toHaveBeenCalled();expect(requestIntake).not.toHaveBeenCalled();expect(run).not.toHaveBeenCalled()})
 it('keeps an unconfirmed scheduler completion visible without invoking a second source fetch',async()=>{finish.mockResolvedValue(false);const response=await GET(req());expect(response.status).toBe(503);expect(await response.text()).toContain('unconfirmed');expect(run).toHaveBeenCalledTimes(1)})

})
