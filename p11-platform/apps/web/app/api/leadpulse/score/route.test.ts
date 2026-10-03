import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), rpc: vi.fn(), from: vi.fn(), leads: [] as {id:string;property_id:string}[] }))
vi.mock('@/utils/supabase/server', () => ({ createClient: async () => ({auth:{getUser:mocks.auth}}) }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient: () => ({rpc:mocks.rpc,from:mocks.from}) }))
vi.mock('@/utils/services/auth-guard', () => ({validatePropertyAccess:mocks.access}))
const requestId='10000000-0000-4000-8000-000000000001'
function request(method:string, body?:unknown, query='') { return new NextRequest('http://localhost/api/leadpulse/test'+query,{method,...(body?{body:JSON.stringify(body),headers:{'Content-Type':'application/json'}}:{})}) }
beforeEach(() => {
 vi.clearAllMocks()
 mocks.auth.mockResolvedValue({data:{user:{id:'actor'}},error:null});mocks.access.mockResolvedValue({authorized:true,orgId:'org'})
 mocks.leads=[{id:'lead-1',property_id:'property-1'}]
 mocks.from.mockImplementation((table:string)=> {
  if(table==='leads') return {select:()=>({in:async()=>({data:mocks.leads,error:null})})}
  if(table==='lead_workflows') { const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:null,error:null})};return q }
  throw new Error('Unexpected table '+table)
 })
})
import {GET,POST,PATCH} from './route'
describe('recorded LeadPulse scores',()=>{
 it('requires authentication for score reads and commands',async()=>{mocks.auth.mockResolvedValue({data:{user:null},error:null});expect((await GET(request('GET',undefined,'?leadId=lead-1'))).status).toBe(401);expect((await POST(request('POST',{requestId,leadId:'lead-1'}))).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('does not calculate when the saved score is absent',async()=>{mocks.rpc.mockResolvedValue({data:{state:'unscored',score:null},error:null});const r=await GET(request('GET',undefined,'?leadId=lead-1'));expect(await r.json()).toEqual({state:'unscored',score:null});expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(mocks.rpc).toHaveBeenCalledWith('read_leadpulse_score',expect.objectContaining({p_actor_id:'actor',p_lead_id:'lead-1'}));expect(r.headers.get('Cache-Control')).toBe('no-store')})
 it('rejects missing request identity and ambiguous targets',async()=>{expect((await POST(request('POST',{leadId:'lead-1'}))).status).toBe(400);expect((await POST(request('POST',{requestId,leadId:'lead-1',leadIds:['lead-1']}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('rejects property mismatch before authorization or scoring',async()=>{expect((await POST(request('POST',{requestId,leadId:'lead-1',propertyId:'wrong'}))).status).toBe(400);expect(mocks.access).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled()})
 it('rejects missing and mixed-property batch targets',async()=>{mocks.leads=[];expect((await POST(request('POST',{requestId,leadIds:['missing']}))).status).toBe(404);mocks.leads=[{id:'lead-1',property_id:'property-1'},{id:'lead-2',property_id:'property-2'}];expect((await POST(request('POST',{requestId,leadIds:['lead-1','lead-2']}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('checks current property membership before scoring',async()=>{mocks.access.mockResolvedValue({authorized:false});expect((await POST(request('POST',{requestId,propertyId:'property-1'}))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('returns persisted per-lead failures instead of claiming batch success',async()=>{mocks.rpc.mockResolvedValue({data:{state:'completed',requestId,total:2,successful:1,failed:1,pending:0,failures:[{leadId:'lead-2',code:'score_failed'}]},error:null});const result=await POST(request('POST',{requestId,propertyId:'property-1'}));expect(await result.json()).toMatchObject({success:false,successful:1,failed:1});expect(mocks.rpc).toHaveBeenCalledWith('run_lead_score_batch',expect.objectContaining({p_request_id:requestId,p_lead_ids:null}))})
 it('marks a page with remaining leads as unfinished',async()=>{mocks.rpc.mockResolvedValue({data:{state:'running',total:504,successful:25,failed:0,pending:479},error:null});expect(await (await POST(request('POST',{requestId,propertyId:'property-1'}))).json()).toMatchObject({state:'running',success:false,pending:479})})
 it('holds an unknown commit result for recovery',async()=>{mocks.rpc.mockResolvedValue({data:null,error:{message:'lost connection'}});const result=await POST(request('POST',{requestId,propertyId:'property-1'}));expect(result.status).toBe(503);expect(await result.json()).not.toHaveProperty('state','failed');expect(mocks.rpc).toHaveBeenCalledTimes(1)})
 it('does not claim success when the committed single score cannot be loaded',async()=>{mocks.rpc.mockResolvedValueOnce({data:{state:'completed',scoreId:'score-1',failed:0},error:null}).mockResolvedValueOnce({data:{state:'unscored',score:null},error:null});expect((await POST(request('POST',{requestId,leadId:'lead-1'}))).status).toBe(503)})
 it('keeps scoring factors separate from live workflow context',async()=>{mocks.rpc.mockResolvedValue({data:{state:'saved',score:{id:'score-1',lead_id:'lead-1',total_score:60,factors:[{factor:'Recorded engagement',type:'positive',impact:'20 points'}],model_version:'rules-v3.0-evidence'},provenance:{status:'captured',eventCount:1}},error:null});const r=await GET(request('GET',undefined,'?leadId=lead-1'));const body=await r.json();expect(body.score.factors).toHaveLength(1);expect(body.score.workflowFactors).toEqual([]);expect(body.score.provenance.status).toBe('captured')})
 it('continues only the saved manifest without accepting new targets',async()=>{mocks.rpc.mockResolvedValue({data:{state:'completed',successful:50},error:null});const r=await PATCH(request('PATCH',{propertyId:'property-1',batchId:requestId,requestId,action:'continue'}));expect(r.status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('continue_lead_score_batch',{p_property_id:'property-1',p_actor_id:'actor',p_batch_id:requestId})})
 it('records stop with a separate stable decision identity',async()=>{mocks.rpc.mockResolvedValue({data:{state:'cancelled'},error:null});expect((await PATCH(request('PATCH',{propertyId:'property-1',batchId:requestId,requestId,action:'cancel'}))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('cancel_lead_score_batch',expect.objectContaining({p_request_id:requestId}))})
})
