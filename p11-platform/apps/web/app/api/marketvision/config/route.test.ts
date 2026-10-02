import {beforeEach,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const mock=vi.hoisted(()=>({user:vi.fn(),access:vi.fn(),manager:vi.fn(),rpc:vi.fn(),from:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:mock.user}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:mock.rpc,from:mock.from})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:mock.access,validatePropertyManagerAccess:mock.manager}))
const propertyId='33333333-3333-3333-3333-333333333333',requestId='55555555-5555-4555-8555-555555555555'
function req(path:string,method='GET',body?:unknown){return new NextRequest(`http://localhost/api/marketvision/${path}`,{method,...(body===undefined?{}:{body:JSON.stringify(body),headers:{'Content-Type':'application/json'}})})}
beforeEach(()=>{vi.clearAllMocks();mock.user.mockResolvedValue({data:{user:{id:'11111111-1111-1111-1111-111111111111'}},error:null});mock.access.mockResolvedValue({authorized:true});mock.manager.mockResolvedValue({authorized:true});mock.rpc.mockResolvedValue({data:{state:'saved',version:1},error:null})})
import {GET,PUT} from './route'
const body={propertyId,requestId,expectedVersion:0,reason:'Reviewed local monitoring',values:{is_enabled:false,scrape_frequency:'manual',radius_miles:3,max_competitors:20,auto_add:false}}
function config(data:unknown,error:unknown=null){const query={select:vi.fn(()=>query),eq:vi.fn(()=>query),maybeSingle:vi.fn(async()=>({data,error}))};mock.from.mockReturnValue(query);return query}
it('requires authentication',async()=>{mock.user.mockResolvedValue({data:{user:null},error:null});expect((await GET(req(`config?propertyId=${propertyId}`))).status).toBe(401)})
it('requires property access to read configuration',async()=>{mock.access.mockResolvedValue({authorized:false});expect((await GET(req(`config?propertyId=${propertyId}`))).status).toBe(403)})
it('distinguishes missing configuration from a read failure',async()=>{config(null);expect(await(await GET(req(`config?propertyId=${propertyId}`))).json()).toEqual({config:null,canManage:true});config(null,{message:'private failure'});const r=await GET(req(`config?propertyId=${propertyId}`));expect(r.status).toBe(503);expect(await r.json()).toEqual({error:expect.stringContaining('could not be loaded')})})
it('loads the exact current configuration and read-only membership',async()=>{config({id:requestId,version:7,is_enabled:false});mock.manager.mockResolvedValue({authorized:false});expect(await(await GET(req(`config?propertyId=${propertyId}`))).json()).toEqual({config:{id:requestId,version:7,is_enabled:false},canManage:false})})
it('requires a manager for settings mutation',async()=>{mock.manager.mockResolvedValue({authorized:false});expect((await PUT(req('config','PUT',body))).status).toBe(403);expect(mock.rpc).not.toHaveBeenCalled()})
it('saves one reviewed configuration command',async()=>{expect((await PUT(req('config','PUT',body))).status).toBe(200);expect(mock.rpc).toHaveBeenCalledWith('save_marketvision_configuration',expect.objectContaining({p_id:requestId,p_input:{expectedVersion:0,reason:body.reason,values:body.values}}))})
it('rejects settings with no exact prior version',async()=>{expect((await PUT(req('config','PUT',{propertyId,isEnabled:true}))).status).toBe(400)})
it('does not hide a stale settings conflict',async()=>{mock.rpc.mockResolvedValue({data:{state:'stale_configuration'},error:null});expect((await PUT(req('config','PUT',body))).status).toBe(409)})
