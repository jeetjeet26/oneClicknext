import {beforeEach,describe,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const m=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),fetch:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:m.auth}})}))
vi.mock('@/utils/crm/workspace',()=>({crmRpc:m.rpc}))
vi.mock('@/utils/services/runtime-config',()=>({getDataEngineUrl:()=> 'http://worker.local'}))
import {GET,POST} from './route'
const property='33333333-3333-3333-3333-333333333333',requestId='df9e624c-df84-4974-bc6c-1032c748e844'
const body={action:'start',propertyId:property,requestId,integrationId:property,revision:2,kind:'schema'}
const req=(b:unknown)=>new NextRequest('http://localhost/api/crm/setup',{method:'POST',body:JSON.stringify(b)})
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('fetch',m.fetch);m.auth.mockResolvedValue({data:{user:{id:'actor'}},error:null})})
describe('saved CRM setup requests',()=>{
 it('does not dispatch when access or version is denied',async()=>{for(const state of ['forbidden','stale','request_conflict','operation_in_progress']){m.rpc.mockResolvedValue({state});expect((await POST(req(body))).status).toBe(state==='forbidden'?403:409)}expect(m.fetch).not.toHaveBeenCalled()})
 it('never accepts a client credential, actor or provider result',async()=>{expect((await POST(req({...body,credentials:{api_key:'client-key'}}))).status).toBe(400);expect((await POST(req({...body,actorId:'other'}))).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled()})
 it('dispatches only a saved queued identity, not credentials or arbitrary actions',async()=>{m.rpc.mockResolvedValueOnce({state:'applied',operation:{id:requestId,state:'queued'}}).mockResolvedValueOnce({state:'saved',operations:[]});m.fetch.mockResolvedValue(new Response('{}'));expect((await POST(req(body))).status).toBe(200);expect(m.fetch.mock.calls[0][0]).toBe('http://worker.local/crm/setup-operation');expect(JSON.parse(m.fetch.mock.calls[0][1].body)).toEqual({operation_id:requestId})})
 it.each(['running','completed','failed','stopped'])('a %s request cannot dispatch again',async state=>{m.rpc.mockResolvedValueOnce({state:'replayed',operation:{id:requestId,state}}).mockResolvedValueOnce({state:'saved',operations:[]});await POST(req(body));expect(m.fetch).not.toHaveBeenCalled()})
 it('uses saved state after lost worker response',async()=>{m.rpc.mockResolvedValueOnce({state:'applied',operation:{id:requestId,state:'queued'}}).mockResolvedValueOnce({state:'saved',operations:[{id:requestId,state:'running'}]});m.fetch.mockRejectedValue(new Error('secret worker error'));const response=await POST(req(body));expect(await response.json()).toMatchObject({operations:[{state:'running'}]});expect(m.fetch).toHaveBeenCalledTimes(1)})
 it('stops through a scoped saved decision without touching the provider',async()=>{m.rpc.mockResolvedValue({state:'applied'});await POST(req({action:'stop',propertyId:property,requestId,operationId:property}));expect(m.rpc).toHaveBeenCalledWith('stop_crm_setup_operation',{p_property_id:property,p_actor_id:'actor',p_request_id:requestId,p_operation_id:property});expect(m.fetch).not.toHaveBeenCalled()})
 it('reading history never invokes the provider',async()=>{m.rpc.mockResolvedValue({state:'saved',operations:[]});expect((await GET(new NextRequest('http://localhost/api/crm/setup?propertyId='+property))).status).toBe(200);expect(m.fetch).not.toHaveBeenCalled()})
})
