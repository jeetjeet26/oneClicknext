import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const m=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),fetch:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:m.auth}})}))
vi.mock('@/utils/crm/workspace',()=>({crmRpc:m.rpc}))
vi.mock('@/utils/services/runtime-config',()=>({getDataEngineUrl:()=> 'http://worker.local'}))
import {GET,POST} from './route'
const property='33333333-3333-3333-3333-333333333333',requestId='df9e624c-df84-4974-bc6c-1032c748e844'
const run={action:'run',propertyId:property,requestId,operationId:property,payloadHash:'a'.repeat(64)}
const req=(b:unknown)=>new NextRequest('http://localhost/api/crm/qualification',{method:'POST',body:JSON.stringify(b)})
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',m.fetch);vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','false');m.auth.mockResolvedValue({data:{user:{id:'actor'}},error:null})})
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()})
describe('Saved CRM provider qualification',()=>{
 it('requires authentication before private reads and commands',async()=>{m.auth.mockResolvedValue({data:{user:null},error:null});expect((await GET(new NextRequest('http://localhost/api/crm/qualification?propertyId='+property))).status).toBe(401);expect((await POST(req(run))).status).toBe(401);expect(m.rpc).not.toHaveBeenCalled()})
 it.each([{credentials:{api_key:'private'}},{actorId:'forged'},{receipts:{created:true}},{payload:{email:'forged'}}])('rejects client authority or evidence %j',async extra=>{expect((await POST(req({...run,...extra}))).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled()})
 it('prepares only the saved configuration without provider work while paused',async()=>{vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','true');m.rpc.mockResolvedValue({state:'saved'});expect((await POST(req({action:'prepare',propertyId:property,requestId,integrationId:property,revision:2}))).status).toBe(200);expect(m.rpc).toHaveBeenCalledWith('prepare_crm_qualification',{p_property_id:property,p_actor_id:'actor',p_request_id:requestId,p_integration_id:property,p_revision:2});expect(m.fetch).not.toHaveBeenCalled()})
 it.each(['run','activate'])('pauses %s before recording authority',async action=>{vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','true');expect((await POST(req({...run,action}))).status).toBe(423);expect(m.rpc).not.toHaveBeenCalled();expect(m.fetch).not.toHaveBeenCalled()})
 it.each(['forbidden','owner_required','preview_conflict','stale_configuration','worker_pending','verification_required'])('holds %s before dispatch',async state=>{m.rpc.mockResolvedValue({state});expect((await POST(req(run))).status).toBe(state==='forbidden'?403:409);expect(m.fetch).not.toHaveBeenCalled()})
 it('only passes a private operation identity to the worker and trusts saved results',async()=>{m.rpc.mockResolvedValueOnce({state:'applied'}).mockResolvedValueOnce({state:'saved',operations:[{state:'running'}]});m.fetch.mockResolvedValue(new Response('{"state":"verified"}'));expect(await (await POST(req(run))).json()).toEqual({state:'saved',operations:[{state:'running'}]});expect(JSON.parse(m.fetch.mock.calls[0][1].body)).toEqual({operation_id:property})})
 it('allows recovery while paused and recovers worker loss through the database',async()=>{vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','true');m.rpc.mockResolvedValueOnce({state:'replayed'}).mockResolvedValueOnce({state:'saved',operations:[{state:'needs_reconciliation'}]});m.fetch.mockRejectedValue(new Error('private-token'));expect(await (await POST(req({...run,action:'recover'}))).json()).toEqual({state:'saved',operations:[{state:'needs_reconciliation'}]});expect(m.fetch).toHaveBeenCalledTimes(1)})
 it.each(['stop','activate'])('%s never dispatches a worker',async action=>{m.rpc.mockResolvedValue({state:'applied'});expect((await POST(req({...run,action}))).status).toBe(200);expect(m.fetch).not.toHaveBeenCalled()})
 it('reads saved evidence without credentials or provider calls',async()=>{m.rpc.mockResolvedValue({state:'saved',operations:[]});const r=await GET(new NextRequest('http://localhost/api/crm/qualification?propertyId='+property));expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(m.rpc).toHaveBeenCalledWith('read_crm_qualifications',{p_property_id:property,p_actor_id:'actor'});expect(m.fetch).not.toHaveBeenCalled()})
})
