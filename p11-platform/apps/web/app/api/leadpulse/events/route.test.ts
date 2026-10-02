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
describe('LeadPulse engagement commands',()=>{
 it('rejects unknown types including inherited object keys',async()=>{for(const eventType of ['not_real','toString']){const r=await POST(request('POST',{requestId,leadId:'lead-1',eventType}));expect(r.status).toBe(400)}expect(mocks.rpc).not.toHaveBeenCalled()})
 it('records event and score atomically with operator provenance',async()=>{mocks.rpc.mockResolvedValue({data:{state:'applied',eventId:'event-1',scoreId:'score-1'},error:null});const r=await POST(request('POST',{requestId,leadId:'lead-1',eventType:'call_inbound',metadata:{note:'Private note'}}));expect(r.status).toBe(200);expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(mocks.rpc).toHaveBeenCalledWith('record_lead_engagement',{p_property_id:'property-1',p_actor_id:'actor',p_lead_id:'lead-1',p_event_type:'call_inbound',p_request_key:`operator/${requestId}`,p_origin:'operator',p_metadata:{note:'Private note'}})})
 it('rejects client weights, origins and unbounded metadata',async()=>{for(const extra of [{scoreWeight:999},{origin:'siteforge'},{metadata:{note:'x'.repeat(6100)}}])expect((await POST(request('POST',{requestId,leadId:'lead-1',eventType:'call_inbound',...extra}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('rejects mismatched property before any mutation',async()=>{expect((await POST(request('POST',{requestId,leadId:'lead-1',propertyId:'other',eventType:'call_inbound'}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('checks membership even on retry',async()=>{mocks.access.mockResolvedValue({authorized:false});expect((await POST(request('POST',{requestId,leadId:'lead-1',eventType:'call_inbound'}))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('returns the saved receipt on replay without a separate rescore',async()=>{mocks.rpc.mockResolvedValue({data:{state:'replayed',scoreId:'original'},error:null});expect(await (await POST(request('POST',{requestId,leadId:'lead-1',eventType:'call_inbound'}))).json()).toMatchObject({state:'replayed',scoreId:'original'});expect(mocks.rpc).toHaveBeenCalledTimes(1)})
 it('does not claim the event saved when the transaction is unknown',async()=>{mocks.rpc.mockResolvedValue({data:null,error:{message:'db unavailable'}});expect((await POST(request('POST',{requestId,leadId:'lead-1',eventType:'call_inbound'}))).status).toBe(503)})
 it('rejects invalid event pagination',async()=>{for(const limit of ['-1','1.5','999','NaN'])expect((await GET(request('GET',undefined,`?leadId=lead-1&limit=${limit}`))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('returns bounded evidence without fetching raw metadata',async()=>{mocks.rpc.mockResolvedValue({data:{state:'saved',events:[],total:70},error:null});const r=await GET(request('GET',undefined,'?leadId=lead-1&limit=20&offset=40'));expect(await r.json()).toMatchObject({events:[],total:70});expect(mocks.rpc).toHaveBeenCalledWith('read_leadpulse_events',expect.objectContaining({p_limit:20,p_offset:40,p_actor_id:'actor'}))})
 it('requires a correction reason and binds it to the saved event',async()=>{expect((await PATCH(request('PATCH',{requestId,eventId:requestId,leadId:'lead-1',propertyId:'property-1',reason:' '}))).status).toBe(400);mocks.rpc.mockResolvedValue({data:{state:'applied'},error:null});expect((await PATCH(request('PATCH',{requestId,eventId:requestId,leadId:'lead-1',propertyId:'property-1',reason:'Recorded in error'}))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('correct_lead_engagement',expect.objectContaining({p_event_id:requestId,p_reason:'Recorded in error'}))})
})
