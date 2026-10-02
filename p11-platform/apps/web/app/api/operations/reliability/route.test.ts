import {beforeEach,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const deps=vi.hoisted(()=>({user:vi.fn(),access:vi.fn(),rpc:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:deps.user}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:deps.rpc})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:deps.access}))
import {GET} from './route'
const req=()=>new NextRequest('http://localhost/api/operations/reliability?propertyId=property')
beforeEach(()=>{vi.resetAllMocks();deps.user.mockResolvedValue({data:{user:{id:'user'}},error:null});deps.access.mockResolvedValue({authorized:true})})
it('requires authentication before reading operational state',async()=>{
 deps.user.mockResolvedValue({data:{user:null},error:null});expect((await GET(req())).status).toBe(401);expect(deps.rpc).not.toHaveBeenCalled()
})
it('rejects another property before service-role reads',async()=>{
 deps.access.mockResolvedValue({authorized:false});expect((await GET(req())).status).toBe(403);expect(deps.rpc).not.toHaveBeenCalled()
})
it('reads only the authorized property without caching',async()=>{
 deps.rpc.mockResolvedValue({data:{requests:[]},error:null});const response=await GET(req())
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store')
 expect(deps.rpc).toHaveBeenCalledWith('phase_four_status',{p_property_id:'property'})
})
it('shows storage failure rather than an empty healthy state',async()=>{
 deps.rpc.mockResolvedValue({data:null,error:{message:'offline'}});expect((await GET(req())).status).toBe(503)
})
