import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), rpc: vi.fn(), from: vi.fn(), leads: [] as {id:string;property_id:string}[] }))
vi.mock('@/utils/supabase/server', () => ({ createClient: async () => ({auth:{getUser:mocks.auth}}) }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient: () => ({rpc:mocks.rpc,from:mocks.from}) }))
vi.mock('@/utils/services/auth-guard', () => ({validatePropertyAccess:mocks.access}))
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
import {GET} from './route'
import {GET as leads} from '../leads/route'
import {GET as batches} from '../batches/route'
describe('LeadPulse reporting',()=>{
 it('requires authentication',async()=>{mocks.auth.mockResolvedValue({data:{user:null},error:null});expect((await GET(request('GET'))).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('requires an explicit authorized property',async()=>{expect((await GET(request('GET'))).status).toBe(400);mocks.access.mockResolvedValue({authorized:false});expect((await GET(request('GET',undefined,'?propertyId=property-1'))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('returns full database aggregates even when no leads exist',async()=>{mocks.rpc.mockResolvedValue({data:{state:'saved',insights:{totalLeads:0,scoredLeads:0,avgScore:0,distribution:[],topFactors:{positive:[],negative:[]},recentTrend:[]}},error:null});const body=await (await GET(request('GET',undefined,'?propertyId=property-1'))).json();expect(body.insights.totalLeads).toBe(0);expect(mocks.rpc).toHaveBeenCalledWith('read_leadpulse_insights',{p_property_id:'property-1',p_actor_id:'actor',p_days:30})})
 it('does not turn a read failure into empty successful insights',async()=>{mocks.rpc.mockResolvedValue({data:null,error:{message:'unavailable'}});expect((await GET(request('GET',undefined,'?propertyId=property-1'))).status).toBe(503)})
 it('validates the insight period',async()=>{for(const days of ['NaN','0','91','2.5'])expect((await GET(request('GET',undefined,`?propertyId=property-1&days=${days}`))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('passes search, bucket and page to a complete property query',async()=>{mocks.rpc.mockResolvedValue({data:{state:'saved',leads:[],total:504,page:3,pages:11},error:null});expect((await leads(request('GET',undefined,'?propertyId=property-1&search=Alice&bucket=warm&page=3'))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('list_leadpulse_leads',expect.objectContaining({p_search:'Alice',p_bucket:'warm',p_page:3}))})
 it('returns no saved run without creating one',async()=>{mocks.rpc.mockResolvedValue({data:{state:'not_found'},error:null});expect(await (await batches(request('GET',undefined,'?propertyId=property-1'))).json()).toEqual({batch:null});expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(mocks.rpc.mock.calls[0][0]).toBe('lead_score_batch_status')})
})
