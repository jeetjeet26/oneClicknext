import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const d=vi.hoisted(()=>({from:vi.fn(),read:vi.fn(),start:vi.fn(),finish:vi.fn(),recover:vi.fn(),status:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:d.from})}))
vi.mock('@/utils/services/cron-job-runs',()=>({startCronJobRun:d.start,confirmCronJobRun:d.finish,finishCronJobRun:d.finish}))
vi.mock('@/utils/marketvision/extraction-store',()=>({recoverExtraction:d.recover,extractionExecutionStatus:d.status}))
import {GET} from './route'
const req=(token='secret')=>new NextRequest('http://localhost/api/cron/process-market-extractions',{headers:{authorization:`Bearer ${token}`}})
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('CRON_SECRET','secret');d.status.mockReturnValue({paused:false,configured:true});d.start.mockResolvedValue({id:'run'});d.finish.mockResolvedValue(undefined);const q={select:()=>q,in:()=>q,order:()=>q,limit:d.read};d.from.mockReturnValue(q);d.read.mockResolvedValue({data:[{id:'saved'}],error:null});d.recover.mockResolvedValue({state:'saved',requestState:'preview_ready'})})
afterEach(()=>vi.unstubAllEnvs())
it('requires scheduler authorization before all work',async()=>{expect((await GET(req('bad'))).status).toBe(401);expect(d.start).not.toHaveBeenCalled();expect(d.recover).not.toHaveBeenCalled()})
it('honors paused and unconfigured execution without claiming requests',async()=>{d.status.mockReturnValue({paused:true,configured:true});expect(await(await GET(req())).json()).toEqual({state:'paused',processed:0});d.status.mockReturnValue({paused:false,configured:false});expect(await(await GET(req())).json()).toEqual({state:'provider_unavailable',processed:0});expect(d.from).not.toHaveBeenCalled()})
it('does not run without a saved scheduled-run record',async()=>{d.start.mockResolvedValue(null);expect((await GET(req())).status).toBe(503);expect(d.recover).not.toHaveBeenCalled()})
it('processes bounded saved work and reports actual preview state',async()=>{const r=await GET(req());expect(await r.json()).toMatchObject({status:'success',processed:1,results:[{requestId:'saved',state:'preview_ready'}]});expect(d.read).toHaveBeenCalledWith(2);expect(d.recover).toHaveBeenCalledWith('saved')})
it('keeps unconfirmed requests visible in partial outcomes',async()=>{d.read.mockResolvedValue({data:[{id:'good'},{id:'lost'}],error:null});d.recover.mockResolvedValueOnce({state:'preview_ready'}).mockRejectedValueOnce(new Error('private error'));const r=await GET(req());expect(await r.json()).toMatchObject({status:'partial',results:[{requestId:'good',state:'preview_ready'},{requestId:'lost',state:'unconfirmed'}]})})
it('does not claim success when the scheduled receipt cannot be saved',async()=>{d.finish.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(undefined);expect((await GET(req())).status).toBe(503)})
