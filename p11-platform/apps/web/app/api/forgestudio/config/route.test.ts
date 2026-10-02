import {beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const {user,access,manager,from,rpc}=vi.hoisted(()=>({user:vi.fn(),access:vi.fn(),manager:vi.fn(),from:vi.fn(),rpc:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:user}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from,rpc})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:access,validatePropertyManagerAccess:manager}))
import {GET,POST} from './route'
import {defaultStudioConfiguration} from '@/utils/forgestudio/configuration'
const propertyId='33333333-3333-4333-8333-333333333333',requestId='44444444-4444-4444-8444-444444444444'
const get=()=>new NextRequest('http://localhost/api/forgestudio/config?propertyId='+propertyId)
const body=()=>({propertyId,requestId,expectedVersion:0,config:defaultStudioConfiguration})
const post=(value:unknown=body())=>new NextRequest('http://localhost/api/forgestudio/config',{method:'POST',body:JSON.stringify(value)})
function query(data:unknown,error:unknown=null){const q={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({data,error})};q.select.mockReturnValue(q);q.eq.mockReturnValue(q);from.mockReturnValue(q);return q}
beforeEach(()=>{vi.clearAllMocks();user.mockResolvedValue({data:{user:{id:'actor'}},error:null});access.mockResolvedValue({authorized:true});manager.mockResolvedValue({authorized:true});query(null);rpc.mockResolvedValue({data:{state:'saved',config:defaultStudioConfiguration,version:1},error:null})})
it('requires authentication for both reading and saving',async()=>{user.mockResolvedValue({data:{user:null}});expect((await GET(get())).status).toBe(401);expect((await POST(post())).status).toBe(401);expect(from).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled()})
it('checks current property scope and manager permission',async()=>{access.mockResolvedValue({authorized:false});manager.mockResolvedValue({authorized:false});expect((await GET(get())).status).toBe(403);expect((await POST(post())).status).toBe(403);expect(rpc).not.toHaveBeenCalled()})
it('returns read-only defaults without inventing model or media controls',async()=>{expect(await(await GET(get())).json()).toEqual({config:defaultStudioConfiguration,version:0,isDefault:true});expect(rpc).not.toHaveBeenCalled()})
it('returns only supported saved fields and their version',async()=>{query({...defaultStudioConfiguration,configuration_version:3,auto_approve:true,id:requestId});expect(await(await GET(get())).json()).toEqual({config:defaultStudioConfiguration,version:3,isDefault:false})})
it('fails visibly on read errors instead of returning defaults',async()=>{query(null,{message:'database unavailable'});expect((await GET(get())).status).toBe(503)})
it('validates all supplied values and rejects unknown identity/control keys',async()=>{for(const invalid of [{...body(),config:{...defaultStudioConfiguration,property_id:propertyId}},{...body(),config:{...defaultStudioConfiguration,max_caption_length:10}},{...body(),config:{...defaultStudioConfiguration,include_hashtags:'false'}},{...body(),config:{...defaultStudioConfiguration,key_amenities:['']}},{...body(),requestId:null}])expect((await POST(post(invalid))).status).toBe(400);expect(rpc).not.toHaveBeenCalled()})
it('saves a stable versioned decision with the real authenticated actor',async()=>{expect((await POST(post())).status).toBe(200);expect(rpc).toHaveBeenCalledWith('save_forgestudio_configuration',{p_id:requestId,p_property_id:propertyId,p_actor_id:'actor',p_payload:{expectedVersion:0,config:defaultStudioConfiguration}})})
it('returns stale saves as a recoverable conflict',async()=>{rpc.mockResolvedValue({data:{state:'stale_configuration'},error:null});const r=await POST(post());expect(r.status).toBe(409);expect((await r.json()).error).toMatch(/Reload the current settings/)})
it('does not claim success after an uncertain database response',async()=>{rpc.mockResolvedValue({data:null,error:{message:'lost'}});expect((await POST(post())).status).toBe(503)})
