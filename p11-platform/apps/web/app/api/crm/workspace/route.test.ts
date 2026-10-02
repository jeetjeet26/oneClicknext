import {beforeEach,describe,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:mocks.auth}})}))
vi.mock('@/utils/crm/workspace',()=>({crmRpc:mocks.rpc}))
import {GET,POST} from './route'
const property='33333333-3333-3333-3333-333333333333',requestId='6a8f7730-e9ed-49a6-8e17-b2c663d81009',actor='signed-in-actor'
const request=(body:unknown)=>new NextRequest('http://localhost/api/crm/workspace',{method:'POST',body:JSON.stringify(body)})
const save={propertyId:property,requestId,action:'save',platform:'lasso',revision:0,credentials:{api_key:'test-secret'},mapping:{email:'Email'}}
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({data:{user:{id:actor}},error:null});mocks.rpc.mockResolvedValue({state:'applied'})})
describe('saved CRM workspace boundary',()=>{
 it('requires authentication before reading saved setup',async()=>{mocks.auth.mockResolvedValue({data:{user:null},error:null});expect((await GET(new NextRequest('http://localhost/api/crm/workspace?propertyId='+property))).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('requires a property on reads and writes',async()=>{expect((await GET(new NextRequest('http://localhost/api/crm/workspace'))).status).toBe(400);expect((await POST(request({...save,propertyId:''}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('uses authenticated identity with current database scope and no cache',async()=>{mocks.rpc.mockResolvedValue({state:'saved',integrations:[]});const r=await GET(new NextRequest('http://localhost/api/crm/workspace?propertyId='+property));expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(mocks.rpc).toHaveBeenCalledWith('read_crm_workspace',{p_property_id:property,p_actor_id:actor})})
 it('cannot accept forged actor or provider-validated flags',async()=>{expect((await POST(request({...save,validated:true}))).status).toBe(400);expect((await POST(request({...save,actorId:'other'}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled()})
 it('binds save identity and expected revision while allowing server-held credentials',async()=>{expect((await POST(request({...save,credentials:null,revision:3}))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('save_crm_mapping_review',expect.objectContaining({p_request_id:requestId,p_actor_id:actor,p_credentials:null,p_revision:3}))})
 it('previews only a saved version and scoped lead',async()=>{await POST(request({propertyId:property,requestId,action:'preview',integrationId:property,revision:4,leadId:property}));expect(mocks.rpc).toHaveBeenCalledWith('preview_crm_mapping',{p_property_id:property,p_actor_id:actor,p_request_id:requestId,p_integration_id:property,p_revision:4,p_lead_id:property})})
 it.each(['forbidden','stale','stale_preview','request_conflict'])('returns %s as a hold',async state=>{mocks.rpc.mockResolvedValue({state});const r=await POST(request({propertyId:property,requestId,action:'approve',previewId:property}));expect(r.status).toBe(state==='forbidden'?403:409);expect((await r.json()).state).toBe(state)})
 it('does not echo database/provider secrets after an unknown acknowledgment',async()=>{mocks.rpc.mockRejectedValue(new Error('test-secret'));const r=await POST(request(save));expect(r.status).toBe(503);expect(await r.text()).not.toContain('test-secret')})
})
