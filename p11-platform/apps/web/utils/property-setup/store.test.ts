import {beforeEach,describe,expect,it,vi}from 'vitest'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn(),access:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:mocks.rpc})}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:mocks.getUser}})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:mocks.access}))
import{requireSetupActor,setupRpc}from './store'
describe('property setup authorization and errors',()=>{beforeEach(()=>vi.clearAllMocks())
 it('uses fresh authentication and property authorization',async()=>{mocks.getUser.mockResolvedValueOnce({data:{user:null},error:null});await expect(requireSetupActor('property')).rejects.toMatchObject({status:401});mocks.getUser.mockResolvedValue({data:{user:{id:'actor'}},error:null});mocks.access.mockResolvedValueOnce({authorized:false});await expect(requireSetupActor('property')).rejects.toMatchObject({status:403});mocks.access.mockResolvedValue({authorized:true});expect(await requireSetupActor('property')).toBe('actor')})
 it('exposes actionable validation but hides raw database details',async()=>{mocks.rpc.mockResolvedValueOnce({data:null,error:{message:'Choose at most one primary contact'}});await expect(setupRpc('save_property_setup',{})).rejects.toMatchObject({status:400,message:'Choose at most one primary contact'});mocks.rpc.mockResolvedValueOnce({data:null,error:{message:'sensitive native details'}});await expect(setupRpc('save_property_setup',{})).rejects.toMatchObject({status:503});mocks.rpc.mockResolvedValueOnce({data:{state:'source_changed'},error:null});await expect(setupRpc('save_property_setup',{})).rejects.toMatchObject({status:409})})
})
