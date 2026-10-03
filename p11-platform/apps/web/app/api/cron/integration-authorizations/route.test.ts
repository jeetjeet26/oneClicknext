import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const d=vi.hoisted(()=>({start:vi.fn(),finish:vi.fn(),expire:vi.fn()}))
vi.mock('@/utils/services/cron-job-runs',()=>({startCronJobRun:d.start,finishCronJobRun:d.finish}))
vi.mock('@/utils/services/integration-authorization',()=>({expireAuthorizationRequests:d.expire}))
import {GET} from './route'
const run={id:'run',jobName:'integration-authorizations',startedAtMs:0},result={state:'completed',processed:3,skipped:0,remaining:false,legacyUnqualified:0}
const invoke=(auth='Bearer fixture',query='')=>GET(new NextRequest('http://localhost/api/cron/integration-authorizations'+query,{headers:{authorization:auth}}))
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('CRON_SECRET','fixture');d.start.mockResolvedValue(run);d.finish.mockResolvedValue(true);d.expire.mockResolvedValue(result)})
afterEach(()=>vi.unstubAllEnvs())
it.each(['','Bearer wrong'])('requires the exact secret and rejects query credentials %s',async auth=>{expect((await invoke(auth,'?secret=fixture')).status).toBe(401);expect(d.start).not.toHaveBeenCalled();expect(d.expire).not.toHaveBeenCalled()})
it('fails closed when no secret is configured',async()=>{vi.stubEnv('CRON_SECRET','');expect((await invoke('Bearer ')).status).toBe(401);expect(d.expire).not.toHaveBeenCalled()})
it('requires the run record before cleanup',async()=>{d.start.mockResolvedValue(null);expect((await invoke()).status).toBe(503);expect(d.expire).not.toHaveBeenCalled()})
it('reports the confirmed bounded cleanup',async()=>{const response=await invoke();expect(response.status).toBe(200);expect(await response.json()).toEqual(result);expect(d.finish).toHaveBeenCalledWith(run,{status:'success',summary:result})})
it.each([{remaining:true},{skipped:1},{legacyUnqualified:1},{state:'busy'}])('records incomplete cleanup as partial %o',async extra=>{d.expire.mockResolvedValue({...result,...extra});expect((await invoke()).status).toBe(200);expect(d.finish).toHaveBeenCalledWith(run,{status:'partial',summary:{...result,...extra}})})
it('does not report a clean run after lost run acknowledgement',async()=>{d.finish.mockResolvedValue(false);expect((await invoke()).status).toBe(503);expect(d.expire).toHaveBeenCalledTimes(1)})
it('records a sanitized failure after uncertain cleanup without retry',async()=>{d.expire.mockRejectedValue(new Error('private database detail'));const response=await invoke();expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toContain('private');expect(d.expire).toHaveBeenCalledTimes(1);expect(d.finish).toHaveBeenCalledWith(run,{status:'failed',error:'Authorization cleanup is unconfirmed.'})})
