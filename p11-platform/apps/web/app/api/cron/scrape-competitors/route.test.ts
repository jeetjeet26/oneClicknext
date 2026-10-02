import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const d=vi.hoisted(()=>({rpc:vi.fn(),start:vi.fn(),finish:vi.fn(),fetch:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:d.rpc})}))
vi.mock('@/utils/services/cron-job-runs',()=>({startCronJobRun:d.start,finishCronJobRun:d.finish,confirmCronJobRun:d.finish}))
import {GET} from './route'
const req=(secret='secret')=>new NextRequest('http://localhost/api/cron/scrape-competitors',{headers:{authorization:`Bearer ${secret}`}})
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('CRON_SECRET','secret');vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','false');vi.stubEnv('DATA_ENGINE_API_KEY','fixture-key');vi.stubGlobal('fetch',d.fetch);d.start.mockResolvedValue({id:'run'});d.rpc.mockImplementation(async(name)=>({data:name==='claim_phase_four_maintenance'?[{property_id:'property',maintenanceId:'item',maintenanceToken:'token'}]:true,error:null}))})
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()})
it('rejects invalid scheduler authentication before claiming',async()=>{expect((await GET(req('wrong'))).status).toBe(401);expect(d.rpc).not.toHaveBeenCalled()})
it('uses the authenticated property-specific refresh endpoint',async()=>{
 d.fetch.mockResolvedValue(new Response(JSON.stringify({success:true,updated_count:2,total_competitors:2,error_count:0})))
 expect((await GET(req())).status).toBe(200)
 expect(d.fetch).toHaveBeenCalledWith(expect.stringContaining('/scraper/refresh-pricing'),expect.objectContaining({headers:expect.objectContaining({'X-API-Key':'fixture-key'}),body:JSON.stringify({property_id:'property',prefer_website:true})}))
 expect(d.rpc).toHaveBeenLastCalledWith('finish_phase_four_maintenance',expect.objectContaining({p_success:true,p_token:'token'}))
})
it('does not mark partial pricing as fresh',async()=>{
 d.fetch.mockResolvedValue(new Response(JSON.stringify({success:true,updated_count:1,total_competitors:2,error_count:1})))
 expect((await GET(req())).status).toBe(502)
 expect(d.rpc).toHaveBeenLastCalledWith('finish_phase_four_maintenance',expect.objectContaining({p_success:false}))
})
it('does not report success without the saved final run receipt',async()=>{
 d.fetch.mockResolvedValue(new Response(JSON.stringify({success:true,updated_count:0,total_competitors:0,error_count:0})))
 d.finish.mockRejectedValueOnce(new Error('receipt missing')).mockResolvedValueOnce(undefined)
 expect((await GET(req())).status).toBe(503)
})

it('does not claim or scrape while outbound delivery is paused',async()=>{vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','true');expect(await(await GET(req())).json()).toEqual({state:'paused',processed:0});expect(d.start).not.toHaveBeenCalled();expect(d.rpc).not.toHaveBeenCalled();expect(d.fetch).not.toHaveBeenCalled()})
