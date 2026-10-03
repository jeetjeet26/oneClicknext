import {beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const d=vi.hoisted(()=>({auth:vi.fn(),access:vi.fn(),rpc:vi.fn(),limit:vi.fn(),profile:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:d.auth}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:d.rpc,from:()=>({select:()=>({eq:()=>({single:d.profile})})})})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:d.access}))
vi.mock('@/utils/services/rate-limiter',()=>({adminLimiter:{check:d.limit},getRateLimitKey:()=> 'fixture',rateLimitHeaders:()=>({})}))
import {GET,POST,PUT} from './route'
const property='33333333-3333-4333-8333-333333333333',requestId='44444444-4444-4444-8444-444444444444',revision='a'.repeat(64)
const body={propertyId:property,requestId,expectedRevision:revision,config:{widget_name:'New name'}}
const call=(method:'GET'|'POST'|'PUT',data:unknown=body)=>({GET,POST,PUT}[method])(new NextRequest(`http://localhost/api/lumaleasing/admin/config?propertyId=${property}`,method==='GET'?{}:{method,headers:{origin:'http://localhost'},body:JSON.stringify(data)}))
beforeEach(()=>{vi.resetAllMocks();d.profile.mockResolvedValue({data:{role:'admin'},error:null});d.auth.mockResolvedValue({data:{user:{id:'actor'}}});d.access.mockResolvedValue({authorized:true});d.limit.mockReturnValue({allowed:true});d.rpc.mockResolvedValue({data:{config:{id:'config'},revision,state:'applied',actionEventId:requestId}})})
it.each(['GET','POST','PUT'] as const)('%s requires authentication',async method=>{d.auth.mockResolvedValue({data:{user:null}});expect((await call(method)).status).toBe(401);expect(d.rpc).not.toHaveBeenCalled()})
it.each(['GET','POST','PUT'] as const)('%s checks property access',async method=>{d.access.mockResolvedValue({authorized:false});expect((await call(method)).status).toBe(403);expect(d.rpc).not.toHaveBeenCalled()})
it('returns absent configuration without calling a writer',async()=>{d.rpc.mockResolvedValue({data:{config:null,revision,effectiveTimezone:null}});const response=await call('GET');expect(await response.json()).toEqual({config:null,revision,effectiveTimezone:null,canManage:true});expect(d.rpc).toHaveBeenCalledWith('read_luma_configuration',{p_property_id:property});expect(response.headers.get('cache-control')).toBe('no-store')})
it('keeps failed reads distinct from missing configuration',async()=>{d.rpc.mockResolvedValue({error:{message:'private fixture error'}});const response=await call('GET');expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'Configuration is unavailable. Retry to load saved settings.'})})
it('requires a stable request and expected version',async()=>{expect((await call('PUT',{...body,requestId:undefined})).status).toBe(400);expect((await call('PUT',{...body,expectedRevision:undefined})).status).toBe(400);expect(d.rpc).not.toHaveBeenCalled()})
it('derives actor from auth and strips client-supplied credentials from changes',async()=>{expect((await call('PUT',{...body,actorId:'forged',config:{...body.config,api_key:'injected'}})).status).toBe(200);expect(d.rpc).toHaveBeenCalledWith('save_recorded_luma_configuration',{p_property_id:property,p_actor_id:'actor',p_request_id:requestId,p_expected_revision:revision,p_operation:'save',p_config:body.config})})
it('initialization is explicit and records an empty initial change',async()=>{expect((await call('POST',{propertyId:property,requestId,expectedRevision:revision})).status).toBe(200);expect(d.rpc).toHaveBeenCalledWith('save_recorded_luma_configuration',expect.objectContaining({p_operation:'initialize',p_config:{}}))})
it.each(['stale_configuration','request_conflict','legacy_timezone_review'])('returns a useful conflict for %s',async state=>{d.rpc.mockResolvedValue({data:{state,actionEventId:requestId}});const response=await call('PUT');expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:state,actionEventId:requestId})})
it('returns an acknowledged replay',async()=>{d.rpc.mockResolvedValue({data:{state:'replayed',config:{id:'config'},revision,actionEventId:requestId}});expect(await(await call('PUT')).json()).toMatchObject({state:'replayed',actionEventId:requestId})})
it.each([null,{state:'applied'},{state:'applied',config:{id:'config'},revision}])('never claims an incomplete save acknowledgement (%j)',async data=>{d.rpc.mockResolvedValue({data});expect((await call('PUT')).status).toBe(503)})
it('rejects invalid business hours before database access',async()=>{expect((await call('PUT',{...body,config:{business_hours:{monday:{start:'18:00',end:'09:00'}}}})).status).toBe(400);expect(d.rpc).not.toHaveBeenCalled()})
it('honors the request limit',async()=>{d.limit.mockReturnValue({allowed:false});expect((await call('PUT')).status).toBe(429);expect(d.rpc).not.toHaveBeenCalled()})

it('accepts existing database UUID identities even when they are not v4',async()=>{const response=await GET(new NextRequest('http://localhost/api/lumaleasing/admin/config?propertyId=33333333-3333-3333-3333-333333333333'));expect(response.status).toBe(200)})
it.each(['javascript:alert(1)','https://user:password@example.com/image.png'])('rejects unsafe public target %s',async url=>{expect((await call('PUT',{...body,config:{floor_plans_url:url}})).status).toBe(400);expect(d.rpc).not.toHaveBeenCalled()})

it('rejects configuration writes from another origin',async()=>{const response=await PUT(new NextRequest('http://localhost/api/lumaleasing/admin/config',{method:'PUT',headers:{origin:'https://other.invalid'},body:JSON.stringify(body)}));expect(response.status).toBe(403);expect(d.rpc).not.toHaveBeenCalled()})
it('discloses current viewer controls without authorizing saves',async()=>{d.profile.mockResolvedValue({data:{role:'viewer'},error:null});expect(await(await call('GET')).json()).toMatchObject({canManage:false})})
