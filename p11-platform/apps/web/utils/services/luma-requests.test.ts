import {lumaRequestContext}from './luma-request-context'
import {beforeEach,describe,it,expect,vi} from 'vitest'
import {NextRequest,NextResponse} from 'next/server'
const deps=vi.hoisted(()=>({rpc:vi.fn(),config:vi.fn(),session:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:deps.rpc,from:()=>({select:()=>({eq:()=>({eq:()=>({single:deps.config,maybeSingle:deps.session})})})})})}))
import {withLumaRequest,saveLumaMessage,linkLumaVisitorLead} from './luma-requests'
const property='33333333-3333-4333-8333-333333333333'
function request(body:Record<string,unknown>={},key='key') {return new NextRequest('http://localhost/api/lumaleasing/lead',{method:'POST',headers:{'content-type':'application/json',...(key?{'x-api-key':key}:{})},body:JSON.stringify({requestId:'11111111-1111-4111-8111-111111111111',email:'fixture@example.invalid',...body})})}
beforeEach(()=>{vi.clearAllMocks();deps.config.mockResolvedValue({data:{property_id:property},error:null})})
describe('durable Luma admission',()=>{
 it('commits response before exposing success',async()=>{
  deps.rpc.mockResolvedValueOnce({data:{state:'claimed',token:'token'},error:null}).mockResolvedValueOnce({data:true,error:null})
  const handler=vi.fn(async()=>NextResponse.json({success:true,leadId:'saved'}))
  const response=await withLumaRequest(request(),'lead',handler)
  expect(response.status).toBe(200);expect(handler).toHaveBeenCalledOnce()
  expect(deps.rpc).toHaveBeenLastCalledWith('finish_recorded_luma_request',expect.objectContaining({p_property_id:property,p_response:{success:true,leadId:'saved'},p_token:'token'}))
 })
 it.each([['running',409],['review',409],['conflict',409],['limited',429]])('does not repeat a %s request',async(state,status)=>{
  deps.rpc.mockResolvedValue({data:{state},error:null});const handler=vi.fn()
  expect((await withLumaRequest(request(),'lead',handler)).status).toBe(status);expect(handler).not.toHaveBeenCalled()
 })
 it('replays confirmed results without touching lead or providers',async()=>{
  deps.rpc.mockResolvedValue({data:{state:'completed',http_status:200,response:{leadId:'original'}},error:null});const handler=vi.fn()
  const result=await withLumaRequest(request(),'lead',handler)
  expect(await result.json()).toEqual({leadId:'original'});expect(handler).not.toHaveBeenCalled()
 })
 it('revalidates key revocation before a replay',async()=>{
  deps.config.mockResolvedValue({data:null,error:{code:'PGRST116'}});const handler=vi.fn()
  expect((await withLumaRequest(request(),'lead',handler)).status).toBe(401);expect(deps.rpc).not.toHaveBeenCalled();expect(handler).not.toHaveBeenCalled()
 })
 it('fails closed on unconfirmed admission',async()=>{
  deps.rpc.mockResolvedValue({data:null,error:null});const handler=vi.fn()
  expect((await withLumaRequest(request(),'lead',handler)).status).toBe(503);expect(handler).not.toHaveBeenCalled()
 })
 it('does not claim success when response persistence is unconfirmed',async()=>{
  deps.rpc.mockResolvedValueOnce({data:{state:'claimed',token:'token'},error:null}).mockResolvedValueOnce({data:false,error:null})
  const result=await withLumaRequest(request(),'lead',async()=>NextResponse.json({success:true}))
  expect(result.status).toBe(503);expect((await result.json()).code).toBe('request_status_unknown')
 })
 it('rejects malformed identities before storage',async()=>{
  const handler=vi.fn();expect((await withLumaRequest(request({requestId:'bad'}),'lead',handler)).status).toBe(400)
  expect(deps.rpc).not.toHaveBeenCalled()
 })
 it('requires confirmed message storage and preserves takeover outcome',async()=>{
  const db={rpc:deps.rpc} as unknown as Parameters<typeof saveLumaMessage>[0]
  deps.rpc.mockResolvedValueOnce({data:null,error:null})
  await expect(saveLumaMessage(db,property,'convo','user','hello')).rejects.toThrow('confirm')
  deps.rpc.mockResolvedValueOnce({data:{saved:false,human:true},error:null})
  expect(await saveLumaMessage(db,property,'convo','assistant','late reply')).toEqual({saved:false,human:true})
 })
})

it('rejects expired sessions before replaying a saved result',async()=>{
 deps.session.mockResolvedValue({data:{last_activity_at:'2020-01-01T00:00:00Z'},error:null})
 const handler=vi.fn()
 expect((await withLumaRequest(request({sessionId:property}),'lead',handler)).status).toBe(410)
 expect(deps.rpc).not.toHaveBeenCalled();expect(handler).not.toHaveBeenCalled()
})
it('distinguishes key lookup outages from revocation',async()=>{
 deps.config.mockResolvedValue({data:null,error:{code:'08006'}})
 expect((await withLumaRequest(request(),'lead',vi.fn())).status).toBe(503)
})
it('rejects invalid JSON before storage',async()=>{
 const req=new NextRequest('http://localhost/test',{method:'POST',body:'{'})
 expect((await withLumaRequest(req,'lead',vi.fn())).status).toBe(400)
 expect(deps.rpc).not.toHaveBeenCalled()
})

it('passes the source mode version through the bound native client and preserves an obsolete response hold',async()=>{
 const db={rpc:deps.rpc}as unknown as Parameters<typeof saveLumaMessage>[0];deps.rpc.mockResolvedValue({data:{saved:false,human:false,stale:true,modeRevision:2},error:null});expect(await saveLumaMessage(db,property,'convo','assistant','original provider response',0)).toEqual({saved:false,human:false,stale:true,modeRevision:2});expect(deps.rpc).toHaveBeenCalledWith('save_luma_message_at_revision',{p_property_id:property,p_conversation_id:'convo',p_role:'assistant',p_content:'original provider response',p_mode_revision:0})
})

it('requires the recorded request and confirmed atomic visitor linkage',async()=>{
 const db={rpc:deps.rpc}as unknown as Parameters<typeof linkLumaVisitorLead>[0]
 await expect(linkLumaVisitorLead(db,property,'lead','session','conversation')).rejects.toThrow('recorded')
 deps.rpc.mockResolvedValueOnce({data:{state:'saved',leadId:'lead'},error:null})
 await lumaRequestContext.run({propertyId:property,requestId:'request',token:'lease'},()=>linkLumaVisitorLead(db,property,'lead','session','conversation'))
 expect(deps.rpc).toHaveBeenCalledWith('link_luma_visitor_lead',{p_property_id:property,p_request_id:'request',p_token:'lease',p_session_id:'session',p_conversation_id:'conversation',p_lead_id:'lead'})
 deps.rpc.mockResolvedValueOnce({data:{state:'contact_conflict'},error:null})
 await expect(lumaRequestContext.run({propertyId:property,requestId:'request',token:'lease'},()=>linkLumaVisitorLead(db,property,'lead','session','conversation'))).rejects.toThrow('not confirmed')
})
