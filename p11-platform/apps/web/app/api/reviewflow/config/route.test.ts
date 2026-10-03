import {beforeEach,describe,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const {operator,role,from,rpc}=vi.hoisted(()=>({operator:vi.fn(),role:vi.fn(),from:vi.fn(),rpc:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from})}))
vi.mock('@/utils/reviewflow/access',async()=>({...await vi.importActual('@/utils/reviewflow/access'),requireReviewOperator:operator,loadProfileRole:role}))
vi.mock('@/utils/reviewflow/response-store',()=>({responseRpc:rpc}))
import {ReviewStoreError} from '@/utils/reviewflow/analysis-store'
import {GET,POST} from './route'
const propertyId='33333333-3333-3333-3333-333333333333',requestId='55555555-5555-4555-8555-555555555555'
function req(body?:unknown,query=`propertyId=${propertyId}`){return new NextRequest('http://localhost/api/reviewflow/settings?'+query,body?{method:'POST',body:JSON.stringify(body)}:undefined)}
function chain(data:unknown,error:unknown=null){const result={data,error},q={select:vi.fn(),eq:vi.fn(),order:vi.fn(),limit:vi.fn(),or:vi.fn(),single:vi.fn().mockResolvedValue(result),maybeSingle:vi.fn().mockResolvedValue(result),then:vi.fn()};for(const k of ['select','eq','order','limit','or'] as const)q[k].mockReturnValue(q);q.then.mockImplementation((r:(v:unknown)=>unknown)=>Promise.resolve(result).then(r));return q}
beforeEach(()=>{vi.clearAllMocks();operator.mockResolvedValue('operator');role.mockResolvedValue('admin');rpc.mockResolvedValue({state:'saved'});from.mockImplementation((table:string)=>chain(table==='properties'?{org_id:'org'}:table==='reviewflow_config'?null:[]))})
const body={propertyId,requestId,expectedVersion:0,defaultTone:'friendly',propertyPersonality:'Warm and clear',reason:'Reviewed response preferences'},RPC_NAME='decide_reviewflow_configuration'
describe('recorded review preferences',()=>{
it('requires current authentication and property access for reads and writes',async()=>{for(const status of [401,403]){operator.mockRejectedValue(new ReviewStoreError('Unavailable',status));expect((await GET(req())).status).toBe(status);expect((await POST(req(body))).status).toBe(status)}expect(from).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled()})
it('requires a manager and rejects unknown payload fields',async()=>{role.mockResolvedValue('member');expect((await POST(req(body))).status).toBe(403);expect((await POST(req({...body,api_key:'unsafe'}))).status).toBe(400);expect(rpc).not.toHaveBeenCalled()})
it('uses the exact version and stable command identity',async()=>{expect((await POST(req(body))).status).toBe(200);expect(rpc).toHaveBeenCalledWith(RPC_NAME,expect.objectContaining({p_id:requestId,p_property_id:propertyId,p_actor_id:'operator',p_input:expect.objectContaining({expectedVersion:0})}))})
it('surfaces read errors and rejects unavailable cursors',async()=>{from.mockReturnValue(chain(null,{message:'private failure'}));const r=await GET(req());expect(r.status).toBe(503);expect(await r.text()).not.toContain('private failure');from.mockImplementation((table:string)=>chain(table==='properties'?{org_id:'org'}:null));expect((await GET(req(undefined,`propertyId=${propertyId}&cursor=${requestId}`))).status).toBe(409)})
it('rejects unwired auto-send flags and unsupported tones',async()=>{for(const change of [{auto_respond_positive:true},{defaultTone:'anything'},{propertyPersonality:'x'.repeat(2001)}])expect((await POST(req({...body,...change}))).status).toBe(400);expect(rpc).not.toHaveBeenCalled()})
it('returns explicit defaults without creating configuration on a read',async()=>{const r=await GET(req());expect(r.status).toBe(200);expect(await r.json()).toMatchObject({config:{version:0,default_tone:'professional'},canManage:true});expect(rpc).not.toHaveBeenCalled()})
})
