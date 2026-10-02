import {beforeEach,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const mock=vi.hoisted(()=>({user:vi.fn(),access:vi.fn(),manager:vi.fn(),rpc:vi.fn(),from:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:mock.user}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:mock.rpc,from:mock.from})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:mock.access,validatePropertyManagerAccess:mock.manager}))
const propertyId='33333333-3333-3333-3333-333333333333',requestId='55555555-5555-4555-8555-555555555555',competitorId='66666666-6666-4666-8666-666666666666'
function req(path:string,method='GET',body?:unknown){return new NextRequest(`http://localhost/api/marketvision/${path}`,{method,...(body===undefined?{}:{body:JSON.stringify(body),headers:{'Content-Type':'application/json'}})})}
beforeEach(()=>{vi.clearAllMocks();mock.user.mockResolvedValue({data:{user:{id:'11111111-1111-1111-1111-111111111111'}},error:null});mock.access.mockResolvedValue({authorized:true});mock.manager.mockResolvedValue({authorized:true});mock.rpc.mockResolvedValue({data:{state:'saved',version:1},error:null})})
import {GET} from './route'
it('scopes cursor and resource to the selected property and current actor',async()=>{mock.rpc.mockResolvedValue({data:{state:'ready',history:[],nextCursor:null},error:null});expect((await GET(req(`history?propertyId=${propertyId}&resourceId=${competitorId}&cursor=${requestId}`))).status).toBe(200);expect(mock.rpc).toHaveBeenCalledWith('read_marketvision_history',{p_property_id:propertyId,p_actor_id:'11111111-1111-1111-1111-111111111111',p_resource_id:competitorId,p_cursor:requestId})})
it('rejects cursor injection before querying',async()=>{expect((await GET(req(`history?propertyId=${propertyId}&cursor=bad,id.gt.0`))).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled()})
it('does not turn failed history reads into empty history',async()=>{mock.rpc.mockResolvedValue({data:null,error:{code:'XX000'}});expect((await GET(req(`history?propertyId=${propertyId}`))).status).toBe(503)})
it('rejects cross-scope history anchors',async()=>{mock.rpc.mockResolvedValue({data:{state:'cursor_changed'},error:null});expect((await GET(req(`history?propertyId=${propertyId}&cursor=${requestId}`))).status).toBe(409)})
